import CampaignGenerateListJob from '../CampaignGenerateListJob'

describe('CampaignGenerateListJob', () => {
    // BullMQ ignores an add whose id is still in the failed set, so a kept
    // failed job would block the scheduler's re-queue of a loading campaign
    test('drops itself once its attempts are used up', () => {
        const job = CampaignGenerateListJob.from({ id: 1, project_id: 2 })

        expect(job.options.jobId).toEqual('cid_1_generate')
        expect(job.options.attempts).toEqual(3)
        expect(job.options.removeOnFail).toBe(true)
    })
})
