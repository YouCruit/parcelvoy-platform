import App from '../../app'
import * as Lock from '../../core/Lock'
import { logger } from '../../config/logger'
import * as CampaignService from '../../campaigns/CampaignService'
import Project from '../../projects/Project'
import { User } from '../../users/User'
import { UserEvent } from '../../users/UserEvent'
import { loadSendJob, messageLock, notifyJourney, prepareSend } from '../MessageTriggerService'

afterEach(() => {
    jest.restoreAllMocks()
})

describe('notifyJourney', () => {
    test('a failed follow-up enqueue does not propagate, but is reported', async () => {
        const error = new Error('redis down')
        jest.spyOn(App.main.queue, 'enqueue').mockRejectedValue(error)
        jest.spyOn(logger, 'error').mockImplementation()
        const notified = jest.spyOn(App.main.error, 'notify')

        await expect(notifyJourney('123')).resolves.toBeUndefined()

        expect(notified).toHaveBeenCalledWith(error, { reference_id: '123', entrance_id: 123 })
    })
})

describe('loadSendJob', () => {
    test('a send that has already completed is skipped and logged', async () => {
        jest.spyOn(User, 'find').mockResolvedValue({ id: 2, project_id: 3 } as any)
        jest.spyOn(UserEvent, 'find').mockResolvedValue(undefined)
        jest.spyOn(Project, 'find').mockResolvedValue({ id: 3 } as any)
        jest.spyOn(CampaignService, 'getCampaignSend').mockResolvedValue({ state: 'sent', hasCompleted: true } as any)
        const info = jest.spyOn(logger, 'info').mockImplementation()

        const result = await loadSendJob({ campaign_id: 1, user_id: 2, reference_type: 'trigger', reference_id: 'ref-a' })

        expect(result).toBeUndefined()
        expect(info).toHaveBeenCalledWith(
            { campaign_id: 1, user_id: 2, reference_id: 'ref-a', state: 'sent' },
            'send:duplicate_skipped',
        )
    })
})

describe('messageLock', () => {
    const message = (reference_id: string) => ({
        campaign: { id: 1 },
        user: { id: 2 },
        context: { reference_id },
    }) as any

    test('two sends to one user with different references take different locks', () => {
        expect(messageLock(message('ref-a'))).toEqual('parcelvoy:send:1:2:ref-a')
        expect(messageLock(message('ref-a'))).not.toEqual(messageLock(message('ref-b')))
    })
})

describe('prepareSend', () => {
    const channel = { provider: {} } as any
    const message = {
        campaign: { id: 1 },
        user: { id: 2 },
        context: { reference_id: 'ref-a' },
    } as any
    const raw = { name: 'email', data: {}, options: { jobId: 'sid_1_2_ref-a' } } as any

    test('a send whose lock is held is re-queued and logged, not dropped', async () => {
        jest.spyOn(Lock, 'acquireLock').mockResolvedValue(false)
        const delay = jest.spyOn(App.main.queue, 'delay').mockResolvedValue()
        const info = jest.spyOn(logger, 'info').mockImplementation()

        await expect(prepareSend(channel, message, raw)).resolves.toBe(false)

        expect(delay).toHaveBeenCalledTimes(1)
        expect(delay.mock.calls[0][0]).toBe(raw)
        expect(delay.mock.calls[0][1]).toBeGreaterThanOrEqual(1000)
        expect(delay.mock.calls[0][1]).toBeLessThanOrEqual(6000)
        expect(info).toHaveBeenCalledWith(
            expect.objectContaining({ campaign_id: 1, user_id: 2, reference_id: 'ref-a' }),
            'send:locked',
        )
    })

    test('a send that gets its lock is not re-queued', async () => {
        const acquire = jest.spyOn(Lock, 'acquireLock').mockResolvedValue(true)
        const delay = jest.spyOn(App.main.queue, 'delay').mockResolvedValue()

        await expect(prepareSend(channel, message, raw)).resolves.toBe(true)

        expect(acquire).toHaveBeenCalledWith({ key: 'parcelvoy:send:1:2:ref-a' })
        expect(delay).not.toHaveBeenCalled()
    })
})
