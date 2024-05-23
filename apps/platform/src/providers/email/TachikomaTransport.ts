import nodemailer from 'nodemailer'

export class TachikomaTransport implements nodemailer.Transport {
    name: string
    version: string

    constructor() {
        this.name = 'TachikomaTransport'
        this.version = '6'
    }

    send(mail: any, callback: (err: (Error | null), info: any) => void) {

        const transporter = mail.mailer.transporter

        if (!transporter || transporter.name !== 'TachikomaTransport') {
            callback(new Error('Invalid transporter'), null)
            return
        }

        const url = 'http://localhost:3100/tachikoma/sendEmail'

        const payload = {
            subject: mail.data.subject,
            from: mail.data.from,
            html: mail.data.html,
            text: mail.data.text,
            to: [{ address: mail.data.to }],
            attachments: mail.data.attachments,
            headers: mail.data.headers,
        }

        fetch(url, {
            method: 'POST',
            body: JSON.stringify(payload),
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`)
                }
                callback(null, { ...response, messageId: response })

            })
            .then(data => {
                callback(null, data)
            })
            .catch(error => {
                callback(error, null)
            })
    }
}
