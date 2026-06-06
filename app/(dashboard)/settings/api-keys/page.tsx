"use client"

import { apiKeys } from "@/lib/api";
import type { ApiKeyDTO } from "@/lib/schemas/apikey";
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Plus, Trash2, Copy, KeyRound } from "lucide-react"
import { formatToLocal } from "@/lib/utils"

import { PageHeader } from "@/components/ui/page-header"

export default function ApiKeysPage() {
    const queryClient = useQueryClient()
    const [createOpen, setCreateOpen] = useState(false)
    const [keyName, setKeyName] = useState("")
    const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null)
    const [toDelete, setToDelete] = useState<ApiKeyDTO | null>(null)

    const { data: keys = [], isLoading } = useQuery({
        queryKey: ["apikeys"],
        queryFn: apiKeys.list,
    })

    const createMutation = useMutation({
        mutationFn: (name: string) => apiKeys.create(name),
        onSuccess: (key) => {
            queryClient.invalidateQueries({ queryKey: ["apikeys"] })
            setCreateOpen(false)
            setKeyName("")
            setNewKey({ name: key.name, key: key.key })
        },
        onError: (e: Error) => toast.error(e.message || "Create failed"),
    })

    const deleteMutation = useMutation({
        mutationFn: (id: string) => apiKeys.remove(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["apikeys"] })
            setToDelete(null)
            toast.success("API key revoked")
        },
        onError: (e: Error) => toast.error(e.message || "Delete failed"),
    })

    return (
        <div className="h-full overflow-y-auto scrollbar-thin p-4 space-y-6">
            <PageHeader
                title={
                    <span className="flex items-center gap-2">
                        <KeyRound className="h-6 w-6" /> API Keys
                    </span>
                }
                description={<>Use these keys with any OpenAI-compatible client to call the gateway at <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">/api/v1/chat/completions</code>.</>}
                actions={
                    <Button onClick={() => setCreateOpen(true)}>
                        <Plus className="h-4 w-4 mr-1" /> Create Key
                    </Button>
                }
            />

            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Your keys</CardTitle>
                    <CardDescription>
                        Secrets are hashed at rest. You can only see a key value at the moment of creation.
                    </CardDescription>
                </CardHeader>
                <CardContent className="px-2 pb-4">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="pl-4">Name</TableHead>
                                <TableHead>Prefix</TableHead>
                                <TableHead className="hidden md:table-cell">Created</TableHead>
                                <TableHead className="hidden md:table-cell">Last used</TableHead>
                                <TableHead className="w-[60px] text-right pr-4">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading && (
                                <TableRow><TableCell colSpan={5} className="text-muted-foreground text-center py-6">Loading...</TableCell></TableRow>
                            )}
                            {!isLoading && keys.length === 0 && (
                                <TableRow><TableCell colSpan={5} className="text-muted-foreground text-center py-6">No API keys yet.</TableCell></TableRow>
                            )}
                            {keys.map((k) => (
                                <TableRow key={k.id}>
                                    <TableCell className="font-medium pl-4">{k.name}</TableCell>
                                    <TableCell><Badge variant="outline" className="font-mono text-xs">{k.prefix}…</Badge></TableCell>
                                    <TableCell className="text-xs text-muted-foreground hidden md:table-cell whitespace-nowrap">{formatToLocal(k.created_at)}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground hidden md:table-cell whitespace-nowrap">{k.last_used_at ? formatToLocal(k.last_used_at) : "—"}</TableCell>
                                    <TableCell className="text-right pr-4">
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setToDelete(k)}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle>New API Key</DialogTitle>
                        <DialogDescription>Give this key a memorable name. You will see the secret only once.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2 py-2">
                        <Label htmlFor="k-name" className="text-xs">Name</Label>
                        <Input id="k-name" autoFocus value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="my-backend" className="h-9 text-sm" />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
                        <Button size="sm" disabled={!keyName.trim() || createMutation.isPending} onClick={() => createMutation.mutate(keyName.trim())}>
                            Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={!!newKey} onOpenChange={(o) => !o && setNewKey(null)}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>Key created: {newKey?.name}</DialogTitle>
                        <DialogDescription>
                            Copy this key now — it cannot be displayed again.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-start gap-2 bg-muted/50 border rounded-md p-2 my-2">
                        <code className="flex-1 min-w-0 font-mono text-xs break-all leading-relaxed">{newKey?.key}</code>
                        <Button
                            variant="outline"
                            size="icon"
                            className="shrink-0"
                            onClick={() => {
                                if (newKey) {
                                    navigator.clipboard.writeText(newKey.key)
                                    toast.success("Copied to clipboard")
                                }
                            }}
                        >
                            <Copy className="h-4 w-4" />
                        </Button>
                    </div>
                    <DialogFooter>
                        <Button onClick={() => setNewKey(null)}>Done</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
                        <AlertDialogDescription>
                            <b>{toDelete?.name}</b> will stop working immediately. Existing integrations using this key will fail.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => toDelete && deleteMutation.mutate(toDelete.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Revoke
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
