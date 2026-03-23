import { z } from 'zod';

export const BaseLogSchema = z.object({
  timestamp: z.union([z.string(), z.number()]),
  level: z.enum(['info', 'warn', 'error', 'debug']),
  message: z.string(),
  stack: z.string().optional(),
});

export type BaseLog = z.infer<typeof BaseLogSchema>;

export const ErrorLogSchema = BaseLogSchema.extend({
  code: z.string().optional(),
  handled: z.boolean().optional(),
});

export type ErrorLog = z.infer<typeof ErrorLogSchema>;

export const RequestLogSchema = BaseLogSchema.extend({
  method: z.string(),
  path: z.string(),
  statusCode: z.number(),
  duration: z.number(),
  ip: z.string(),
  location: z.object({
    country: z.string(),
    city: z.string(),
    latitude: z.number(),
    longitude: z.number(),
  }).optional(),
});

export type RequestLog = z.infer<typeof RequestLogSchema>;

export const AuditLogSchema = BaseLogSchema.extend({
  userId: z.string().uuid(),
  action: z.string(),
  resource: z.string(),
  details: z.record(z.unknown()).optional(),
});

export type AuditLog = z.infer<typeof AuditLogSchema>;

export interface LogEntry {
  id: string;
  timestamp: string | number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  metadata?: Record<string, any>;
  stack?: string;
}

export interface SecurityEvent {
  id: string;
  timestamp: string;
  type: string;
  action: string;
  success: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details?: Record<string, any>;
}  