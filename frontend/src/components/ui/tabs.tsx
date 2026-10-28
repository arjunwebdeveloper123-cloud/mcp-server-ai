import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root

export const TabsList = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List className={cn('flex gap-6 border-b border-line', className)} {...props} />
)

export const TabsTrigger = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn(
      '-mb-px border-b-2 border-transparent pb-2.5 text-sm font-medium text-muted transition-colors hover:text-ink data-[state=active]:border-signal data-[state=active]:text-ink',
      className
    )}
    {...props}
  />
)

export const TabsContent = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content className={cn('pt-5 focus-visible:outline-none', className)} {...props} />
)
