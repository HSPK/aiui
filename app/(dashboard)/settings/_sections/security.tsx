"use client"

import * as React from "react"
import { Lock } from "lucide-react"
import { toast } from "sonner"

import { auth } from "@/lib/api/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { SettingsField, SettingsSection } from "./shared"

/**
 * Self-service password rotation. Server requires the current
 * password (so a stolen cookie can't lock the legit user out) and
 * revokes every session on success — the next request from this tab
 * will 401 and the auth context redirects to /login.
 */
export function SecuritySection() {
    const [current, setCurrent] = React.useState("")
    const [next, setNext] = React.useState("")
    const [confirm, setConfirm] = React.useState("")
    const [busy, setBusy] = React.useState(false)

    const submit = async () => {
        if (!current || !next) return
        if (next !== confirm) {
            toast.error("New passwords do not match")
            return
        }
        if (next.length < 4) {
            toast.error("Password must be at least 4 characters")
            return
        }
        setBusy(true)
        try {
            await auth.changeOwnPassword({ current_password: current, new_password: next })
            toast.success("Password updated — please log in again")
            setCurrent(""); setNext(""); setConfirm("")
            await auth.logout().catch(() => { /* sessions already revoked */ })
            window.location.href = "/login"
        } catch (e) {
            toast.error((e as Error).message || "Failed to update password")
        } finally {
            setBusy(false)
        }
    }

    return (
        <SettingsSection
            icon={Lock}
            title="Password"
            description="Change your password. All other sessions will be signed out."
        >
            <SettingsField label="Current">
                <Input
                    type="password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    autoComplete="current-password"
                />
            </SettingsField>
            <SettingsField label="New">
                <Input
                    type="password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    autoComplete="new-password"
                />
            </SettingsField>
            <SettingsField label="Confirm">
                <Input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                />
            </SettingsField>
            <SettingsField label="">
                <Button
                    size="sm"
                    onClick={submit}
                    disabled={busy || !current || !next || !confirm}
                >
                    Update password
                </Button>
            </SettingsField>
        </SettingsSection>
    )
}
