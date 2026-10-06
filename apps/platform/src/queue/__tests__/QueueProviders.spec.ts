import MemoryQueueProvider from '../MemoryQueueProvider'
import RedisQueueProvider from '../RedisQueueProvider'
import SQSQueueProvider from '../SQSQueueProvider'
import Job from '../Job'
import { logger } from '../../config/logger'

afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
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

describe('MemoryQueueProvider', () => {
    test('delaying the job being processed re-queues it after the delay', async () => {
        jest.useFakeTimers({ doNotFake: ['performance'] })
        const provider = new MemoryQueueProvider({} as any)
        const job = new TestJob({})
        job.options.jobId = 'sid_1_2_ref-a'

        await provider.delay(job, 3000)
        expect(provider.backlog).toEqual([])
        expect(provider.timers.size).toBe(1)

        jest.advanceTimersByTime(3000)
        await Promise.resolve()

        expect(provider.timers.size).toBe(0)

        expect(provider.backlog).toEqual(['sid_1_2_ref-a'])
        expect(provider.jobs['sid_1_2_ref-a']).toBe(job)
    })

    test('a job re-queued while its dequeue is in flight stays registered', async () => {
        jest.useFakeTimers({ doNotFake: ['performance'] })
        const job = new TestJob({})
        job.options.jobId = 'sid_1_2_ref-c'
        const dequeue = jest.fn().mockImplementationOnce(async () => {
            await provider.delay(job, 0)
            jest.advanceTimersByTime(0)
        })
        const provider: MemoryQueueProvider = new MemoryQueueProvider({ dequeue } as any)
        provider.jobs['sid_1_2_ref-c'] = job
        provider.backlog = ['sid_1_2_ref-c']

        ;(provider as any).process()
        for (let i = 0; i < 10; i++) await Promise.resolve()

        expect(dequeue).toHaveBeenCalledTimes(2)
    })

    test('close cancels a pending delayed re-queue', async () => {
        jest.useFakeTimers({ doNotFake: ['performance'] })
        const provider = new MemoryQueueProvider({} as any)
        const job = new TestJob({})
        job.options.jobId = 'sid_1_2_ref-b'

        await provider.delay(job, 3000)
        provider.close()

        jest.advanceTimersByTime(3000)
        await Promise.resolve()

        expect(provider.backlog).toEqual([])
        expect(provider.jobs['sid_1_2_ref-b']).toBeUndefined()
        expect(jest.getTimerCount()).toBe(0)
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
