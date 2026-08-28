import { useCallback, useContext } from 'react'
import { ProjectContext, UserContext } from '../../contexts'
import { SearchTable, useSearchTableQueryState } from '../../ui/SearchTable'
import api from '../../api'
import { Button, Tag } from '../../ui'
import { ForbiddenIcon } from '../../ui/icons'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PreferencesContext } from '../../ui/PreferencesContext'
import { formatDate } from '../../utils'

export default function UserDetailJourneys() {

    const { t } = useTranslation()
    const navigate = useNavigate()

    const [project] = useContext(ProjectContext)
    const [user] = useContext(UserContext)

    const projectId = project.id
    const userId = user.id

    const [preferences] = useContext(PreferencesContext)
    const state = useSearchTableQueryState(useCallback(async params => await api.users.journeys.search(projectId, userId, params), [projectId, userId]))

    const stopJourney = async (event: React.MouseEvent<HTMLButtonElement, MouseEvent>, journeyId: number) => {
        event.stopPropagation()
        if (confirm(t('stop_journey_confirmation'))) {
            await api.journeys.exit(projectId, journeyId, userId)
            await state.reload()
        }
    }

    return (
        <SearchTable
            {...state}
            title={t('journeys')}
            columns={[
                {
                    key: 'journey',
                    title: t('journey'),
                    cell: ({ item }) => item.journey!.name,
                },
                {
                    key: 'created_at',
                    title: t('created_at'),
                },
                {
                    key: 'ended_at',
                    title: t('ended_at'),
                    cell: ({ item }) => item.ended_at
                        ? formatDate(preferences, item.ended_at, 'Ppp')
                        : <Tag variant="info">{t('running')}</Tag>,
                },
                {
                    key: 'options',
                    title: t('options'),
                    cell: ({ item }) => !item.ended_at && (
                        <Button
                            icon={<ForbiddenIcon />}
                            size="small"
                            variant="destructive"
                            onClickCapture={async (event) => await stopJourney(event, item.journey!.id)}
                        >{t('stop_journey')}</Button>
                    ),
                },
            ]}
            onSelectRow={e => navigate(`../../entrances/${e.entrance_id}`)}
        />
    )
}
