import React, { useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface ProviderIconProps {
    providerName: string;
    className?: string;
    width?: number;
    height?: number;
}

const PROVIDER_LOGOS: Record<string, string> = {
    'openai': '/providers/openai.svg',
    'claude': '/providers/claude.svg',
    'anthropic': '/providers/claude.svg',
    'gemini': '/providers/gemini.svg',
    'google': '/providers/gemini.svg',
    'vertexai': '/providers/vertexai.svg',
    'vertex': '/providers/vertex.svg',
    'deepseek': '/providers/deepseek.png',
    'moonshot': '/providers/moonshot.png',
    'zhipu': '/providers/zhipu.png',
    'aliyun': '/providers/alibabacloud.png',
    'alibabacloud': '/providers/alibabacloud.png',
    'siliconflow': '/providers/siliconflow.svg',
    'tei': '/providers/tei.svg',
    'transformers': '/providers/transformers.svg',
    "baichuan": '/providers/baichuan.png',
    "volcengine": '/providers/volcengine.png',
    "stepfun": '/providers/stepfun.png',
};

export function ProviderIcon({
    providerName,
    className,
    width = 24,
    height = 24
}: ProviderIconProps) {
    const [imgError, setImgError] = useState(false);

    // Normalize provider name for lookup (lowercase, remove spaces/special chars if needed)
    const normalizedName = providerName.toLowerCase().replace(/[^a-z0-9_]/g, '');

    // Try to find a direct match or use the normalized name to construct a path
    // We try to match known mappings first
    let logoSrc = PROVIDER_LOGOS[normalizedName];

    // If no mapping, try to guess the filename (assuming .svg or .png)
    // However, since we can't check file existence on client easily without trying to load it,
    // we'll rely on the mapping or a default strategy if we wanted to be more dynamic.
    // For now, let's stick to the mapping + fallback.
    // Actually the requirement says "look in public/providers". 
    // Since we can't key off the filesystem at runtime in client component easily without a list,
    // we'll try to load mapped one. If mapped one is missing, we fallback to text.
    // IF the user wants auto-discovery, we'd need a server component or a pre-generated map.
    // Given the list from `ls`, manually mapping is safest.

    const isDarkInvert = ['openai', 'vertex', 'vertexai', 'siliconflow'].includes(normalizedName);

    if (logoSrc && !imgError) {
        return (
            <div className={cn("relative shrink-0 flex items-center justify-center", className)} style={{ width, height }}>
                <Image
                    src={logoSrc}
                    alt={providerName}
                    width={width}
                    height={height}
                    className={cn("object-contain", isDarkInvert && "dark:invert")}
                    onError={() => setImgError(true)}
                />
            </div>
        );
    }

    return (
        <div
            className={cn(
                "rounded-lg bg-primary/5 flex items-center justify-center border border-primary/10 transition-colors shrink-0",
                className
            )}
            style={{ width, height }}
        >
            <span className="text-xs font-bold text-primary/80">
                {providerName.substring(0, 2).toUpperCase()}
            </span>
        </div>
    );
}
