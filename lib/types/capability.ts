export interface Capability {
    id: string;
    label: string;
    description: string | null;
    endpoint: string;
    supports_streaming: boolean;
}
