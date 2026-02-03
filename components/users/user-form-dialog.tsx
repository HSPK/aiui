"use client"

import { useState, useEffect } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { User, UserCreateParams, UserUpdateParams } from "@/lib/types"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { Eye, EyeOff, Loader2, Shield, User as UserIcon } from "lucide-react"

interface UserFormDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    mode: "create" | "edit"
    user?: User | null
}

export function UserFormDialog({
    open,
    onOpenChange,
    mode,
    user,
}: UserFormDialogProps) {
    const queryClient = useQueryClient()
    const [showPassword, setShowPassword] = useState(false)

    // Form state
    const [username, setUsername] = useState("")
    const [password, setPassword] = useState("")
    const [role, setRole] = useState<"admin" | "user">("user")

    // Reset form when dialog opens/closes or user changes
    useEffect(() => {
        if (open) {
            if (mode === "edit" && user) {
                setUsername(user.username)
                setPassword("")
                setRole(user.role)
            } else {
                setUsername("")
                setPassword("")
                setRole("user")
            }
            setShowPassword(false)
        }
    }, [open, mode, user])

    const createMutation = useMutation({
        mutationFn: (data: UserCreateParams) => api.createUser(data),
        onSuccess: () => {
            toast.success("User created successfully")
            queryClient.invalidateQueries({ queryKey: ["users"] })
            onOpenChange(false)
        },
        onError: (error: Error) => {
            toast.error(error.message || "Create failed")
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ username, data }: { username: string; data: UserUpdateParams }) =>
            api.updateUser(username, data),
        onSuccess: () => {
            toast.success("User updated successfully")
            queryClient.invalidateQueries({ queryKey: ["users"] })
            onOpenChange(false)
        },
        onError: (error: Error) => {
            toast.error(error.message || "Update failed")
        },
    })

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()

        if (mode === "create") {
            if (!username.trim()) {
                toast.error("Please enter a username")
                return
            }
            if (!password) {
                toast.error("Please enter a password")
                return
            }
            createMutation.mutate({
                username: username.trim(),
                password,
                role,
            })
        } else if (user) {
            const updateData: UserUpdateParams = { role }
            if (password) {
                updateData.password = password
            }
            updateMutation.mutate({
                username: user.username,
                data: updateData,
            })
        }
    }

    const isLoading = createMutation.isPending || updateMutation.isPending

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>
                        {mode === "create" ? "Add User" : "Edit User"}
                    </DialogTitle>
                    <DialogDescription>
                        {mode === "create"
                            ? "Create a new user account"
                            : `Update user "${user?.username}"`}
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit}>
                    <div className="grid gap-4 py-4">
                        {/* Username */}
                        <div className="grid gap-2">
                            <Label htmlFor="username" className="text-xs">Username</Label>
                            <Input
                                id="username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Enter username"
                                disabled={mode === "edit"}
                                className={`h-9 text-sm ${mode === "edit" ? "bg-muted" : ""}`}
                            />
                        </div>

                        {/* Password */}
                        <div className="grid gap-2">
                            <Label htmlFor="password" className="text-xs">
                                {mode === "create" ? "Password" : "New Password"}
                            </Label>
                            <div className="relative">
                                <Input
                                    id="password"
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={mode === "create" ? "Enter password" : "Leave blank to keep unchanged"}
                                    className="h-9 text-sm pr-10"
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-0 top-0 h-9 w-9 text-muted-foreground hover:text-foreground"
                                    onClick={() => setShowPassword(!showPassword)}
                                >
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </Button>
                            </div>
                        </div>

                        {/* Role */}
                        <div className="grid gap-2">
                            <Label htmlFor="role" className="text-xs">Role</Label>
                            <Select value={role} onValueChange={(val: "admin" | "user") => setRole(val)}>
                                <SelectTrigger id="role" className="h-9 text-sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="user">
                                        <div className="flex items-center gap-2">
                                            <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                            <span>User</span>
                                        </div>
                                    </SelectItem>
                                    <SelectItem value="admin">
                                        <div className="flex items-center gap-2">
                                            <Shield className="h-3.5 w-3.5 text-primary" />
                                            <span>Admin</span>
                                        </div>
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onOpenChange(false)}
                            disabled={isLoading}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" size="sm" disabled={isLoading}>
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {mode === "create" ? "Create" : "Save"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
