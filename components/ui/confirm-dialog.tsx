"use client"

import * as React from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
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
import { cn } from "@/lib/utils"

interface ConfirmDialogProps {
    /** Truthy → dialog open. Passing the resource being acted on (e.g. the
     *  row to delete) doubles as the open flag — the caller stores it in
     *  state, then `onOpenChange(false)` clears it. */
    open: boolean
    onOpenChange: (open: boolean) => void
    title: React.ReactNode
    description: React.ReactNode
    /** Action button label. Default: "Confirm". */
    confirmLabel?: React.ReactNode
    cancelLabel?: React.ReactNode
    /** When true, action button is styled as destructive (red) and a
     *  warning icon is prepended to the title. */
    destructive?: boolean
    /** Disable buttons + show a spinner on the action while the mutation runs. */
    isLoading?: boolean
    onConfirm: () => void
}

/**
 * Single source of truth for confirm-style alert dialogs (delete, revoke,
 * etc.). Replaces ~25 lines of AlertDialog boilerplate at every call site.
 *
 * Idiomatic usage:
 *   const [toDelete, setToDelete] = useState<X | null>(null)
 *   const remove = xResource.useDelete({ onSuccess: () => setToDelete(null) })
 *   <ConfirmDialog
 *       open={!!toDelete}
 *       onOpenChange={(o) => !o && setToDelete(null)}
 *       title="Delete X?"
 *       description={<>This will permanently delete <b>{toDelete?.name}</b>.</>}
 *       destructive
 *       isLoading={remove.isPending}
 *       onConfirm={() => toDelete && remove.mutate(toDelete.id)}
 *   />
 */
export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive,
    isLoading,
    onConfirm,
}: ConfirmDialogProps) {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <div className="flex items-start gap-3">
                        {destructive && (
                            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                                <AlertTriangle className="h-4 w-4" />
                            </div>
                        )}
                        <div className="flex-1 space-y-1.5">
                            <AlertDialogTitle className={cn(destructive && "text-foreground")}>
                                {title}
                            </AlertDialogTitle>
                            <AlertDialogDescription>{description}</AlertDialogDescription>
                        </div>
                    </div>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isLoading}>{cancelLabel}</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(e) => {
                            e.preventDefault()
                            onConfirm()
                        }}
                        disabled={isLoading}
                        className={cn(
                            destructive &&
                                "bg-destructive text-white shadow-sm shadow-destructive/30 hover:bg-destructive/90 focus-visible:ring-destructive/40",
                        )}
                    >
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {confirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
