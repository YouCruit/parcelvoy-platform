import { cleanupExpiredRevokedTokens } from '../auth/TokenRepository'
import { subDays, subHours } from 'date-fns'
import nodeScheduler from 'node-schedule'
import App from '../app'
import ProcessCampaignsJob from '../campaigns/ProcessCampaignsJob'
import JourneyDelayJob from '../journey/JourneyDelayJob'
import ProcessListsJob from '../lists/ProcessListsJob'
import CampaignStateJob from '../campaigns/CampaignStateJob'
import UserSchemaSyncJob from '../schema/UserSchemaSyncJob'
import UpdateJourneysJob from '../journey/UpdateJourneysJob'
import ScheduledEntranceOrchestratorJob from '../journey/ScheduledEntranceOrchestratorJob'
import { acquireLock } from '../core/Lock'
import { logger } from './logger'
import Job from '../queue/Job'

// Scheduler ticks are fire-and-forget and re-run on the next tick, so a
// failed enqueue is logged rather than left as an unhandled rejection
const enqueueSafely = (app: App, job: Job) => {
    app.queue.enqueue(job).catch(error => logger.error(error, 'scheduler:error:enqueue'))
}

export default (app: App) => {
    const scheduler = new Scheduler(app)
    scheduler.schedule({
        rule: '* * * * *',
        callback: () => {
            JourneyDelayJob.enqueueActive(app).catch(error => logger.error(error, 'scheduler:error:enqueue'))
            enqueueSafely(app, ProcessCampaignsJob.from())
            enqueueSafely(app, CampaignStateJob.from())
        },
        lockLength: 120,
    })
    scheduler.schedule({
        rule: '*/5 * * * *',
        callback: () => {
            enqueueSafely(app, ProcessListsJob.from())
        },
        lockLength: 360,
    })
    scheduler.schedule({
        rule: '0 * * * *',
        callback: () => {
            cleanupExpiredRevokedTokens(subDays(new Date(), 1))
            enqueueSafely(app, UserSchemaSyncJob.from({
                delta: subHours(new Date(), 1),
            }))
            enqueueSafely(app, UpdateJourneysJob.from())
            enqueueSafely(app, ScheduledEntranceOrchestratorJob.from())
        },
    })
    return scheduler
}

interface Schedule {
    rule: string
    name?: string
    callback: () => void
    lockLength?: number
}

export class Scheduler {
    app: App
    constructor(app: App) {
        this.app = app
    }

    async schedule({ rule, name, callback, lockLength = 3600 }: Schedule) {
        nodeScheduler.scheduleJob(rule, async () => {
            const lock = await acquireLock({
                key: name ?? rule,
                owner: this.app.uuid,
                timeout: lockLength,
            })
            if (lock) {
                callback()
            }
        })
    }

    async close() {
        return await nodeScheduler.gracefulShutdown()
    }
}
