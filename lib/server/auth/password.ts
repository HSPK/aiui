import "server-only";
import bcrypt from "bcryptjs";

const BCRYPT_COST = 10;

export async function hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
    if (!hash) return false;
    return bcrypt.compare(plain, hash);
}
