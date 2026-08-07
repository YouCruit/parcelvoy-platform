import nodemailer from 'nodemailer'
import Provider, { ExternalProviderParams, ProviderControllers, ProviderSchema, ProviderSetupMeta } from '../Provider'
import { createController } from '../ProviderService'
import EmailProvider from './EmailProvider'
import { decodeHashid, encodeHashid } from '../../utilities'
import { getUserFromEmail } from '../../users/UserRepository'
import { getCampaign } from '../../campaigns/CampaignService'
import { trackMessageEvent } from '../../render/LinkService'
import App from '../../app'
import Router = require('@koa/router');
import { TachikomaTransport } from './TachikomaTransport'

interface TachikomaDataParams {
    bridgeUrl: string
    bridgeToken: string
}

type TachikomaEmailProviderParams = Pick<TachikomaEmailProvider, keyof ExternalProviderParams>

export default class TachikomaEmailProvider extends EmailProvider {
    host!: string
    port!: number
    secure!: boolean
    bridgeUrl!: string
    bridgeToken!: string

    static namespace = 'tachikoma' // internal id — coupled to the /tachikoma webhook path, the bridge's parcelvoyUri, and existing provider rows; do NOT rename
    static meta = {
        name: 'Lanefinder Email Bridge',
        icon: 'https://parcelvoy.com/providers/webhook.svg',
        paths: {
            'Webhook URL': `/${this.namespace}`,
        },
    }

    static schema = ProviderSchema<TachikomaEmailProviderParams, TachikomaDataParams>('tachikomaProviderParams', {
        type: 'object',
        required: ['bridgeUrl', 'bridgeToken'],
        properties: {
            bridgeUrl: { type: 'string' },
            bridgeToken: { type: 'string' },
        },
        additionalProperties: false,
    })

    loadSetup(app: App): ProviderSetupMeta[] {
        return [{
            name: 'Webhook URL',
            value: `http://api:${app.env.port}/api/providers/${encodeHashid(this.id)}/${(this.constructor as any).namespace}`,
        }]
    }

    boot() {
        this.transport = nodemailer.createTransport(
            new TachikomaTransport(this.bridgeUrl, this.bridgeToken),
        )
    }

    static controllers(): ProviderControllers {
        const admin = createController('email', this)
        const router = new Router<{ provider: Provider }>()
        router.post(`/${this.namespace}`, async ctx => {
            const provider = ctx.state.provider

            ctx.status = 204

            const { recipient: email, event, message: { headers } } = ctx.request.body['event-data']
            const campaignId = decodeHashid(headers['X-Campaign-Id'])
            if (!email || !campaignId) return
            const projectId = provider.project_id
            const user = await getUserFromEmail(projectId, email)
            const campaign = await getCampaign(campaignId, projectId)
            if (!user || !campaign) return

            const action = ['bounced', 'complained', 'unsubscribed']
                .includes(event)
                ? 'unsubscribe'
                : undefined

            await trackMessageEvent({ user, campaign }, event, action)
        })

        return { admin, public: router }
    }
}
