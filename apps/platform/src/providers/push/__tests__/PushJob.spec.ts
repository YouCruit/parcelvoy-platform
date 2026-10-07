import { DelayedError } from 'bullmq'
import App from '../../../app'
import * as Lock from '../../../core/Lock'
import * as CampaignService from '../../../campaigns/CampaignService'
import * as MessageTriggerService from '../../MessageTriggerService'
import * as PushIndex from '../index'
import PushJob from '../PushJob'

afterEach(() => {
    jest.restoreAllMocks()
})

describe('PushJob.handler', () => {
    const trigger = { campaign_id: 1, user_id: 2, reference_id: 'ref-a' } as any
    const raw = { name: 'push', data: trigger, options: { jobId: 'sid_1_2_ref-a' } } as any
    const hydrated = {
        campaign: { id: 1, provider_id: 3 },
        template: {},
        user: { id: 2, external_id: 'u-2' },
        project: { id: 4 },
        context: { reference_id: 'ref-a' },
    } as any

    const arrange = () => {
        jest.spyOn(MessageTriggerService, 'loadSendJob').mockResolvedValue(hydrated)
        const send = jest.fn().mockResolvedValue({ invalidTokens: [] })
        jest.spyOn(PushIndex, 'loadPushChannel').mockResolvedValue({ provider: {}, send } as any)
        jest.spyOn(MessageTriggerService, 'finalizeSend').mockResolvedValue(undefined as any)
        jest.spyOn(CampaignService, 'updateSendState').mockResolvedValue(undefined as any)
        return {
            send,
            notify: jest.spyOn(App.main.error, 'notify').mockImplementation(),
            release: jest.spyOn(Lock, 'releaseLock').mockResolvedValue(undefined as any),
            delay: jest.spyOn(App.main.queue, 'delay'),
        }
    }

    test('a re-queue from prepareSend propagates and releases no lock it does not hold', async () => {
        const { send, notify, release, delay } = arrange()
        jest.spyOn(Lock, 'acquireLock').mockResolvedValue(false)
        delay.mockRejectedValue(new DelayedError())

        await expect(PushJob.handler(trigger, raw)).rejects.toBeInstanceOf(DelayedError)

        expect(notify).not.toHaveBeenCalled()
        expect(release).not.toHaveBeenCalled()
        expect(send).not.toHaveBeenCalled()
    })

    test('a successful send releases the lock exactly once', async () => {
        const { send, notify, release, delay } = arrange()
        jest.spyOn(Lock, 'acquireLock').mockResolvedValue(true)

        await PushJob.handler(trigger, raw)

        expect(send).toHaveBeenCalledTimes(1)
        expect(delay).not.toHaveBeenCalled()
        expect(notify).not.toHaveBeenCalled()
        expect(release).toHaveBeenCalledTimes(1)
        expect(release).toHaveBeenCalledWith('parcelvoy:send:1:2:ref-a')
    })
})
