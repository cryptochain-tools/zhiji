import type { ComponentProps } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@zhiji/design/alert'
import { Badge } from '@zhiji/design/badge'
import { Button } from '@zhiji/design/button'
import { Card } from '@zhiji/design/card'
import { Empty as DesignEmpty, EmptyMedia } from '@zhiji/design/empty'
import { Input } from '@zhiji/design/input'
import { NativeSelect } from '@zhiji/design/native-select'
import { PageHeader } from '@zhiji/design/page-header'
import { Spinner } from '@zhiji/design/spinner'
import { StatCard } from '@zhiji/design/stat-item'
import { Table, TableBody, TableHead, TableHeader, TableRow, TableCell } from '@zhiji/design/table'
import { Textarea } from '@zhiji/design/textarea'

export function ConsoleButton({ className, ...props }: ComponentProps<typeof Button>) {
  const classes = typeof className === 'string' ? className.split(' ') : []
  const variant = classes.includes('danger') ? 'destructive' : classes.includes('secondary') ? 'secondary' : classes.includes('link') ? 'link' : 'default'
  return <Button variant={variant} className={className} {...props} />
}
export const ConsoleInput = Input
export const ConsoleSelect = NativeSelect
export const ConsoleTextarea = Textarea
export const ConsoleCard = Card
export const ConsoleBadge = Badge
export const ConsoleEmpty = DesignEmpty
export const ConsoleEmptyMedia = EmptyMedia
export const ConsoleSpinner = Spinner
export const ConsolePageHeader = PageHeader

export const ConsoleAlert = Alert
export const ConsoleAlertTitle = AlertTitle
export const ConsoleAlertDescription = AlertDescription
export const ConsoleStatCard = StatCard
export const ConsoleTable = Table
export const ConsoleTableHeader = TableHeader
export const ConsoleTableBody = TableBody
export const ConsoleTableHead = TableHead
export const ConsoleTableRow = TableRow
export const ConsoleTableCell = TableCell
