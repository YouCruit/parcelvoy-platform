import App from '../../app'
import * as Lock from '../../core/Lock'
import * as MessageTriggerService from '../MessageTriggerService'
import * as EmailIndex from '../email'
import * as TextIndex from '../text'
import * as WebhookIndex from '../webhook'
import EmailJob from '../email/EmailJob'
import TextJob from '../text/TextJob'
import WebhookJob from '../webhook/WebhookJob'

afterEach(() => {
    jest.restoreAllMocks()
})

describe('send job lock release', () => {
    const trigger = { campaign_id: 1, user_id: 2, reference_id: 'ref-a' } as any
    const raw = { name: 'send', data: trigger, options: { jobId: 'sid_1_2_ref-a' } } as any
    const hydrated = {
        campaign: { id: 1, provider_id: 3 },
        template: {},
        user: { id: 2, external_id: 'u-2' },
        project: { id: 4 },
        context: { reference_id: 'ref-a' },
    } as any

    const cases: Array<[string, { handler: (t: any, r: any) => Promise<void> }, () => jest.SpyInstance]> = [
        ['EmailJob', EmailJob, () => jest.spyOn(EmailIndex, 'loadEmailChannel')],
        ['TextJob', TextJob, () => jest.spyOn(TextIndex, 'loadTextChannel')],
        ['WebhookJob', WebhookJob, () => jest.spyOn(WebhookIndex, 'loadWebhookChannel')],
    ]

    describe.each(cases)('%s', (_, job, spyOnLoader) => {
        const arrange = (send: jest.Mock) => {
            jest.spyOn(MessageTriggerService, 'loadSendJob').mockResolvedValue(hydrated)
            spyOnLoader().mockResolvedValue({ provider: {}, send, segments: jest.fn().mockResolvedValue(1) } as any)
            jest.spyOn(MessageTriggerService, 'prepareSend').mockResolvedValue(true)
            jest.spyOn(MessageTriggerService, 'finalizeSend').mockResolvedValue(undefined as any)
            jest.spyOn(MessageTriggerService, 'failSend').mockResolvedValue(undefined as any)
            jest.spyOn(App.main.error, 'notify').mockImplementation()
            return jest.spyOn(Lock, 'releaseLock').mockResolvedValue(undefined as any)
        }

        test('a successful send releases the lock exactly once', async () => {
            const send = jest.fn().mockResolvedValue({})
            const release = arrange(send)

            await job.handler(trigger, raw)

            expect(send).toHaveBeenCalledTimes(1)
            expect(release).toHaveBeenCalledTimes(1)
            expect(release).toHaveBeenCalledWith('parcelvoy:send:1:2:ref-a')
        })

        test('a failed send still releases the lock', async () => {
            const send = jest.fn().mockRejectedValue(new Error('provider down'))
            const release = arrange(send)

            await job.handler(trigger, raw)

            expect(MessageTriggerService.failSend).toHaveBeenCalledTimes(1)
            expect(release).toHaveBeenCalledTimes(1)
            expect(release).toHaveBeenCalledWith('parcelvoy:send:1:2:ref-a')
        })
    })
})
