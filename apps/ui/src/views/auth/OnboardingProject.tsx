import ProjectForm from '../project/ProjectForm'

export default function OnboardingProject() {
    return (
        <>
            <h1>Project Setup</h1>
            <p>At Parcelvoy, projects represent a single workspace for sending messages. You can use them for creating staging environments, isolating different clients, etc. Let&apos;s create your first one to get you started!</p>
            <ProjectForm />
        </>
    )
}
