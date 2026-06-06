export interface ApiKey {
    id: string;
    name: string;
    prefix: string;
    last_used_at?: string | null;
    created_at: string;
}
