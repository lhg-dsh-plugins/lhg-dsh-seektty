import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { NativeInteractions } from '../src/host/native-interactions.ts'
import type { RpcRequest, MuxFrame } from '../vendor/api-contract/api/index.ts'

const agent = { id: SessionId('root') }
const question = { agent, questions: [{ id: 'q', question: 'Choose', options: [{ label: 'A' }, { label: 'B' }] }] }

function settlement(promise: Promise<unknown>): Promise<'settled' | 'pending'> {
  return Promise.race([
    promise.then(() => 'settled' as const, () => 'settled' as const),
    new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 50)),
  ])
}

describe('native human interaction bridge: broken observer vs questions()', () => {
  it('sink throws on question/resolved: respond() must not throw and the question must settle', async () => {
    const interactions = new NativeInteractions()
    const frames: RpcRequest<MuxFrame>[] = []
    interactions.subscribe(frame => frames.push(frame))
    interactions.subscribe(frame => {
      if (frame.payload.type === 'question/resolved') throw new Error('broken terminal')
    })
    const promise = interactions.questions(question, async () => ({ answers: [] }))
    const rpcId = frames[0]!.rpcId
    let respondThrew = false
    let receipt: unknown
    try {
      receipt = interactions.respond({ type: 'client-response', rpcId, result: { ok: true,
        value: { sessionId: 'root', answer: { answers: [{ id: 'q', selected: ['A'] }] } } } })
    } catch { respondThrew = true }
    const state = await settlement(promise)
    console.log(`resolved-frame case: respondThrew=${respondThrew} receipt=${JSON.stringify(receipt)} settlement=${state}`)
    expect(respondThrew).toBe(false)
    expect(receipt).toEqual({ accepted: true })
    await expect(promise).resolves.toEqual({ answers: [{ id: 'q', selected: ['A'] }] })
    interactions.dispose()
  })

  it('sink throws on question/requested: question must reject ASK_ABORTED and withdraw the wait', async () => {
    const interactions = new NativeInteractions()
    interactions.subscribe(frame => {
      if (frame.payload.type === 'question/requested') throw new Error('broken terminal')
    })
    const promise = interactions.questions(question, async () => ({ answers: [] }))
    const state = await settlement(promise)
    const replay: RpcRequest<MuxFrame>[] = []
    interactions.replay('root', frame => replay.push(frame))
    console.log(`requested-frame case: settlement=${state} replayPending=${replay.length}`)
    await expect(promise).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(replay).toEqual([])
    interactions.dispose()
  })
})
