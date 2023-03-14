import { JourneyStepType } from '../../../types'
import TextField from '../../../ui/form/TextField'
import { ExperimentStepIcon } from '../../../ui/icons'
import { round } from '../../../utils'

interface ExperimentStepChildConfig {
    ratio: number
}

export const experimentStep: JourneyStepType<{}, ExperimentStepChildConfig> = {
    name: 'Experiment',
    icon: <ExperimentStepIcon />,
    category: 'flow',
    description: 'Randomly send users down different paths.',
    newEdgeData: async () => ({ ratio: 1 }),
    Edit: () => (
        <div style={{ maxWidth: 300 }}>
            Connect this step to others and configure ratios
            to control what proportion of users will be sent
            down each path.
        </div>
    ),
    EditEdge({
        siblingData,
        onChange,
        value,
    }) {
        const ratio = value.ratio ?? 0
        const totalRatio = siblingData.reduce((a, c) => a + c.ratio ?? 0, ratio)
        const percentage = totalRatio > 0 ? round(ratio / totalRatio * 100, 2) : 0
        return (
            <TextField
                name="ratio"
                label="Ratio"
                subtitle={`${percentage}% of users will follow this path.`}
                type="number"
                size="small"
                value={value.ratio ?? 0}
                onChange={str => onChange({ ...value, ratio: parseFloat(str) })}
            />
        )
    },
    sources: 'multi',
}
