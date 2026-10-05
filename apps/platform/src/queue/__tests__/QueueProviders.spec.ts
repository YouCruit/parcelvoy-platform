import RedisQueueProvider from '../RedisQueueProvider'
import SQSQueueProvider from '../SQSQueueProvider'
import Job from '../Job'
import { logger } from '../../config/logger'

afterEach(() => {
    jest.restoreAllMocks()
})

class TestJob extends Job {
    static $name = 'test_job'
}

describe('RedisQueueProvider', () => {
    test('enqueue rethrows when bull.add fails', async () => {
        const provider = Object.create(RedisQueueProvider.prototype) as RedisQueueProvider
        const error = new Error('redis down')
        provider.bull = { add: jest.fn().mockRejectedValue(error) } as any
        const logged = jest.spyOn(logger, 'error').mockImplementation()

        await expect(provider.enqueue(new TestJob({}))).rejects.toBe(error)
        expect(logged).toHaveBeenCalledWith(error, 'redis:error:enqueue')
    })

    test('a job\'s own removeOnFail overrides the provider default', async () => {
        const provider = Object.create(RedisQueueProvider.prototype) as RedisQueueProvider
        const add = jest.fn().mockResolvedValue(undefined)
        provider.bull = { add } as any
        const job = new TestJob({})
        job.options.removeOnFail = true

        await provider.enqueue(job)

        expect(add.mock.calls[0][2].removeOnFail).toBe(true)
    })

    test('jobs without removeOnFail keep the provider default', async () => {
        const provider = Object.create(RedisQueueProvider.prototype) as RedisQueueProvider
        const add = jest.fn().mockResolvedValue(undefined)
        provider.bull = { add } as any

        await provider.enqueue(new TestJob({}))

        expect(add.mock.calls[0][2].removeOnFail).toEqual({ count: 50, age: 24 * 3600 })
    })
})

describe('SQSQueueProvider', () => {
    const build = (sqs: Record<string, jest.Mock>) => {
        const provider = Object.create(SQSQueueProvider.prototype) as SQSQueueProvider
        provider.config = { driver: 'sqs', queueUrl: 'https://sqs.test/queue', region: 'us-east-1' } as any
        provider.sqs = sqs as any
        return provider
    }

    test('enqueue rethrows when sendMessage fails', async () => {
        const error = new Error('sqs down')
        const provider = build({ sendMessage: jest.fn().mockRejectedValue(error) })
        const logged = jest.spyOn(logger, 'error').mockImplementation()

        await expect(provider.enqueue(new TestJob({}))).rejects.toBe(error)
        expect(logged).toHaveBeenCalledWith(error, 'sqs:error:enqueue')
    })

    test('enqueueBatch rethrows when sendMessageBatch fails', async () => {
        const error = new Error('sqs down')
        const provider = build({ sendMessageBatch: jest.fn().mockRejectedValue(error) })
        const logged = jest.spyOn(logger, 'error').mockImplementation()

        await expect(provider.enqueueBatch([new TestJob({})])).rejects.toBe(error)
        expect(logged).toHaveBeenCalledWith(error, 'sqs:error:enqueue')
    })
})
