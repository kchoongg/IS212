import { z } from "zod";

/// SPM-71 (AC4): marking one notification as read. Only `true` - the story asks
/// for marking read, not for marking unread again.
export const markNotificationSchema = z.object({
  isRead: z.literal(true),
});
export type MarkNotificationInput = z.infer<typeof markNotificationSchema>;
