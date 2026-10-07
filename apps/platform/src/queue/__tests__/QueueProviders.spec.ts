import MemoryQueueProvider from '../MemoryQueueProvider'
import RedisQueueProvider from '../RedisQueueProvider'
import SQSQueueProvider from '../SQSQueueProvider'
import Job from '../Job'
import Queue from '../Queue'
import App from '../../app'
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

    describe('worker failed handler', () => {
        // The shared test setup has already loaded the real bullmq into the
        // module registry, so the provider is re-required against a stub
        const startWorker = () => {
            const on = jest.fn()
            let Provider!: typeof RedisQueueProvider
            jest.isolateModules(() => {
                jest.doMock('bullmq', () => ({
                    ...jest.requireActual('bullmq'),
                    Worker: jest.fn().mockImplementation(() => ({ on })),
                }))
                require('../../app') // same load order as the setup file, which the module cycles depend on
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                Provider = require('../RedisQueueProvider').default
            })
            const provider = Object.create(Provider.prototype) as RedisQueueProvider
            const errored = jest.fn()
            provider.queue = { errored } as any
            provider.start()
            const failed = on.mock.calls.find(([event]) => event === 'failed')![1]
            return { failed, errored }
        }

        test('reports a retried attempt as not exhausted', () => {
            const { failed, errored } = startWorker()
            const error = new Error('boom')
            const data = { name: 'test_job' }

            failed({ data, attemptsMade: 2, opts: { attempts: 5 } }, error)

            expect(errored).toHaveBeenCalledWith(error, data, { made: 2, max: 5, exhausted: false })
        })

        test('treats a job without attempts as a single attempt', () => {
            const { failed, errored } = startWorker()
            const error = new Error('boom')
            const data = { name: 'test_job' }

            failed({ data, attemptsMade: 1, opts: {}, finishedOn: 1 }, error)

            expect(errored).toHaveBeenCalledWith(error, data, { made: 1, max: 1, exhausted: true })
        })

        test('a job failed for stalling is exhausted though it counted no attempt', () => {
            const { failed, errored } = startWorker()
            const error = new Error('job stalled more than allowable limit')
            const data = { name: 'test_job' }

            failed({ data, attemptsMade: 0, opts: { attempts: 8 }, finishedOn: 1 }, error)

            expect(errored).toHaveBeenCalledWith(error, data, { made: 0, max: 8, exhausted: true })
        })

        test('a stalled job already removed on fail arrives without a job and is exhausted', () => {
            const { failed, errored } = startWorker()
            const error = new Error('job stalled more than allowable limit')

            failed(undefined, error)

            expect(errored).toHaveBeenCalledWith(error, undefined, { made: 0, max: 1, exhausted: true })
        })
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

    test('enqueueBatch rethrows and logs when bull.addBulk fails', async () => {
        const provider = Object.create(RedisQueueProvider.prototype) as RedisQueueProvider
        const error = new Error('redis down')
        provider.bull = { addBulk: jest.fn().mockRejectedValue(error) } as any
        const logged = jest.spyOn(logger, 'error').mockImplementation()

        await expect(provider.enqueueBatch([new TestJob({})])).rejects.toBe(error)
        expect(logged).toHaveBeenCalledWith(error, 'redis:error:enqueue')
    })

    test('a job\'s own backoff reaches bull.add', async () => {
        const provider = Object.create(RedisQueueProvider.prototype) as RedisQueueProvider
        const add = jest.fn().mockResolvedValue(undefined)
        provider.bull = { add } as any
        const job = new TestJob({})
        job.options.backoff = { type: 'exponential', delay: 5000 }

        await provider.enqueue(job)

        expect(add.mock.calls[0][2].backoff).toEqual({ type: 'exponential', delay: 5000 })
    })

    test('jobs without removeOnFail keep the provider default', async () => {
        const provider = Object.create(RedisQueueProvider.prototype) as RedisQueueProvider
        const add = jest.fn().mockResolvedValue(undefined)
        provider.bull = { add } as any

        await provider.enqueue(new TestJob({}))

        expect(add.mock.calls[0][2].removeOnFail).toEqual({ count: 50, age: 24 * 3600 })
    })
})

describe('Queue.errored', () => {
    const queue = Object.create(Queue.prototype) as Queue
    const job = new TestJob({}).toJSON() as any

    test('a failed attempt that will be retried is not marked exhausted', async () => {
        const logged = jest.spyOn(logger, 'error').mockImplementation()
        const notified = jest.spyOn(App.main.error, 'notify').mockImplementation()
        const error = new Error('boom')

        const attempts = { made: 1, max: 3, exhausted: false }
        await queue.errored(error, job, attempts)

        expect(logged).toHaveBeenCalledWith(expect.objectContaining({ attempts }), 'queue:job:errored')
        expect(logged).not.toHaveBeenCalledWith(expect.anything(), 'queue:job:exhausted')
        expect(notified).toHaveBeenCalledWith(error, { ...job, attempts })
    })

    test('the last failed attempt is marked exhausted', async () => {
        const logged = jest.spyOn(logger, 'error').mockImplementation()
        jest.spyOn(App.main.error, 'notify').mockImplementation()

        const attempts = { made: 3, max: 3, exhausted: true }
        await queue.errored(new Error('boom'), job, attempts)

        expect(logged).toHaveBeenCalledWith({ job, attempts }, 'queue:job:exhausted')
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
        jest.useFakeTimers({ doNotFake: ['performance', 'setImmediate'] })
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
        await new Promise(resolve => setImmediate(resolve))

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
