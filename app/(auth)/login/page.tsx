"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/context/auth-context"
import { Loader2 } from "lucide-react"

export default function LoginPage() {
    const { login } = useAuth()
    const [isLoading, setIsLoading] = useState(false)

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setIsLoading(true)

        const formData = new FormData(event.currentTarget)
        const username = formData.get("email") as string // Backend expects 'user_name'
        const password = formData.get("password") as string

        try {
            await login({
                user_name: username,
                user_password: password
            })
        } catch (error) {
            // Error is handled by toast in AuthProvider
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="flex h-screen w-full items-center justify-center px-4 bg-muted/40">
            <Card className="mx-auto max-w-sm w-full">
                <CardHeader>
                    <CardTitle className="text-2xl">Login</CardTitle>
                    <CardDescription>
                        Enter your credentials to access the AI Gateway Console.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit}>
                        <div className="grid gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="email">Username</Label>
                                <Input
                                    id="email"
                                    name="email"
                                    type="text"
                                    placeholder="admin"
                                    required
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="password">Password</Label>
                                <Input id="password" name="password" type="password" required />
                            </div>
                            <Button type="submit" className="w-full" disabled={isLoading}>
                                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                Sign In
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    )
}
