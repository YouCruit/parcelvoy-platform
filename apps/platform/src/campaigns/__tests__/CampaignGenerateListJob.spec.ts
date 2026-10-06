import * as Lock from '../../core/Lock'
import * as CampaignService from '../CampaignService'
import CampaignGenerateListJob from '../CampaignGenerateListJob'

afterEach(() => {
    jest.restoreAllMocks()
})

describe('CampaignGenerateListJob', () => {
    const params = { id: 1, project_id: 2 }

    beforeEach(() => {
        jest.spyOn(CampaignService, 'getCampaign').mockResolvedValue({ ...params, state: 'loading' } as any)
        jest.spyOn(CampaignService, 'estimatedSendSize').mockResolvedValue(10)
        jest.spyOn(Lock, 'acquireLock').mockResolvedValue(true)
    })

    // A held lock makes BullMQ's retries finish quietly, so the failed job
    // is never kept under its fixed id to swallow the scheduler's re-queue
    test('keeps the lock when generating the send list fails', async () => {
        const error = new Error('db down')
        jest.spyOn(CampaignService, 'generateSendList').mockRejectedValue(error)
        const released = jest.spyOn(Lock, 'releaseLock').mockResolvedValue()

        await expect(CampaignGenerateListJob.handler(params)).rejects.toBe(error)

        expect(released).not.toHaveBeenCalled()
    })

    test('a retry that finds the lock held finishes without generating', async () => {
        jest.spyOn(Lock, 'acquireLock').mockResolvedValue(false)
        const generated = jest.spyOn(CampaignService, 'generateSendList')

        await expect(CampaignGenerateListJob.handler(params)).resolves.toBeUndefined()

        expect(generated).not.toHaveBeenCalled()
    })
})
