export default function ProvidersPage() {
    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight">Model Providers</h2>
            <div className="grid gap-4 md:grid-cols-3">
                <div className="border rounded-md p-4 h-32 flex items-center justify-center bg-card">OpenAI</div>
                <div className="border rounded-md p-4 h-32 flex items-center justify-center bg-card">Anthropic</div>
                <div className="border rounded-md p-4 h-32 flex items-center justify-center bg-card">Google Gemini</div>
            </div>
        </div>
    )
}
