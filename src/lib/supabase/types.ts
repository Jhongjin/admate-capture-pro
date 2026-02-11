/**
 * Supabase Database Types
 *
 * `vision_da_captures` 테이블과 동기화
 */

export type CaptureStatus = "pending" | "processing" | "completed" | "failed";
export type ChannelType = "gdn" | "youtube" | "meta" | "naver";

export interface VisionDaCaptureRow {
  id: string; // uuid
  created_at: string;
  updated_at?: string; // managed by trigger or manually? existing table has created_at
  
  // Existing columns from screenshot
  campaign_id?: string | null; // uuid, FK to vision_da_campaigns
  screenshot_storage_path?: string | null; // text
  source_url?: string | null; // text (use this for publisher_url)
  captured_at?: string | null; // timestamptz

  // New columns required for MVP (need migration)
  status: CaptureStatus;
  channel: ChannelType;
  creative_url: string; // The ad creative URL
  click_url?: string | null; // The ad click URL
  capture_landing: boolean;
  
  // Storage URLs (full public URLs for easy access)
  placement_image_url?: string | null; 
  landing_image_url?: string | null;
  landing_final_url?: string | null;

  error_message?: string | null;
  metadata?: Record<string, unknown> | null; // jsonb
  user_id?: string | null; // uuid
}

export type VisionDaCaptureInsert = Omit<VisionDaCaptureRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

export type VisionDaCaptureUpdate = Partial<VisionDaCaptureInsert>;
