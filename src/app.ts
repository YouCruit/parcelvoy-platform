import Api from './api'
import loadDatabase, { Database, migrate } from './config/database'
import loadQueue from './config/queue'
import { Env } from './config/env'
import scheduler from './config/scheduler'
import Queue from './queue'

export default class App {
    private static $main: App
    static get main() {
        if (!App.$main) {
            throw new Error('Instance not setup')
        }
        return App.$main
    }

    static async init(env: Env): Promise<App> {
        // Load database
        const database = loadDatabase(env.db)

        // Migrate to latest version
        await migrate(database)

        // Load queue
        const queue = loadQueue(env.queue)

        // Setup app
        App.$main = new App(env, database, queue)

        return App.$main
    }

    api: Api
    scheduler: any
    #registered: { [key: string | number]: unknown }

    // eslint-disable-next-line no-useless-constructor
    private constructor(
        public env: Env,
        public db: Database,
        public queue: Queue,
    ) {
        this.api = new Api(this)
        this.scheduler = scheduler(this)
        this.#registered = {}
    }

    listen() {
        this.api.listen(this.env.port)
    }

    async close() {
        await this.db.destroy()
        await this.queue.close()
    }

    get<T>(key: number | string): T {
        return this.#registered[key] as T
    }

    set(key: number | string, value: unknown) {
        this.#registered[key] = value
    }
}
