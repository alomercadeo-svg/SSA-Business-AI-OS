import type { Platform } from "@/lib/platforms";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type { Platform };

/**
 * Quién opera el canal. `zernio` es la API oficial de Meta; `evolution` es el
 * WhatsApp autoalojado. Migración 00022.
 */
export type ChannelProvider = "zernio" | "evolution";

/** Condiciones que registra el receptor de webhooks. Migración 00022. */
export type WebhookAlertCondition = "webhook_auth_failed" | "webhook_unknown_instance";

/**
 * Estado de una integración (F24, migración 00024). `sin_verificar` es "no se
 * pudo preguntar" y nunca se muestra como `desconectado`.
 */
export type IntegrationEstado = "conectado" | "desconectado" | "sin_verificar" | "sin_configurar";
export type IntegrationTipo = "canal" | "correo" | "ia";

export type FlowStatus = "draft" | "published" | "archived";
export type ConversationStatus = "open" | "closed" | "snoozed";
export type MessageDirection = "inbound" | "outbound";
export type MessageStatus = "pending" | "sent" | "delivered" | "failed";
export type BroadcastStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "completed"
  | "cancelled";
export type JobStatus = "pending" | "processing" | "completed" | "failed";
export type TriggerType =
  | "keyword"
  | "postback"
  | "quick_reply"
  | "welcome"
  | "default"
  | "comment_keyword";
export type FlowSessionStatus =
  | "active"
  | "completed"
  | "expired"
  | "cancelled";
export type NodeType =
  | "trigger"
  | "sendMessage"
  | "condition"
  | "delay"
  | "addTag"
  | "removeTag"
  | "setCustomField"
  | "httpRequest"
  | "goToFlow"
  | "subscribe"
  | "unsubscribe"
  | "humanTakeover"
  | "commentReply"
  | "privateReply"
  | "abSplit"
  | "smartDelay"
  | "aiResponse"
  | "enrollSequence";

export type SequenceStatus = "draft" | "active" | "paused";
export type SequenceEnrollmentStatus = "active" | "completed" | "cancelled";

export interface SequenceStep {
  type: "message" | "delay";
  /** Message text (for message steps) */
  content?: string;
  /** Delay in minutes (for delay steps) */
  delayMinutes?: number;
}

export interface Database {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string;
          name: string;
          slug: string;
          /**
           * Las API keys NO están acá. La 00021 borró
           * `late_api_key_encrypted` y `ai_api_key`: viven en Supabase Vault y
           * se leen con lib/vault.ts. `webhook_secret` sí sigue en la tabla,
           * porque lib/zernio-webhook.ts lo necesita para validar firmas, y
           * está protegido por lib/safe-columns.ts.
           */
          ai_provider: string;
          global_keywords: Json | null;
          unassigned_leads_visible_to_members: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          ai_provider?: string;
          global_keywords?: Json | null;
          unassigned_leads_visible_to_members?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          ai_provider?: string;
          global_keywords?: Json | null;
          unassigned_leads_visible_to_members?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          workspace_id: string;
          user_id: string;
          role: string;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role?: string;
          created_at?: string;
        };
        Update: {
          role?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      channels: {
        Row: {
          id: string;
          workspace_id: string;
          platform: Platform;
          /**
           * Nulo en los canales de Evolution, que no tienen cuenta de Zernio
           * (migración 00022). Toda lectura necesita guarda: el patrón del repo
           * es `if (!channel?.late_account_id) return;`.
           */
          late_account_id: string | null;
          provider: ChannelProvider;
          instance_name: string | null;
          username: string | null;
          display_name: string | null;
          profile_picture: string | null;
          webhook_id: string | null;
          webhook_secret: string | null;
          is_active: boolean;
          last_comment_cursor: string | null;
          comment_rules: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          platform: Platform;
          late_account_id?: string | null;
          provider?: ChannelProvider;
          instance_name?: string | null;
          username?: string | null;
          display_name?: string | null;
          profile_picture?: string | null;
          webhook_id?: string | null;
          webhook_secret?: string | null;
          is_active?: boolean;
          last_comment_cursor?: string | null;
          comment_rules?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          platform?: Platform;
          late_account_id?: string | null;
          provider?: ChannelProvider;
          instance_name?: string | null;
          username?: string | null;
          display_name?: string | null;
          profile_picture?: string | null;
          webhook_id?: string | null;
          webhook_secret?: string | null;
          is_active?: boolean;
          last_comment_cursor?: string | null;
          comment_rules?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "channels_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contacts: {
        Row: {
          id: string;
          workspace_id: string;
          display_name: string | null;
          email: string | null;
          avatar_url: string | null;
          is_subscribed: boolean;
          last_interaction_at: string | null;
          metadata: Json | null;
          /** Asignación: define el scope de lectura del lead para un Member (F3). */
          setter_id: string | null;
          vendedor_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          display_name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
          is_subscribed?: boolean;
          last_interaction_at?: string | null;
          metadata?: Json | null;
          setter_id?: string | null;
          vendedor_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string | null;
          email?: string | null;
          avatar_url?: string | null;
          is_subscribed?: boolean;
          last_interaction_at?: string | null;
          metadata?: Json | null;
          setter_id?: string | null;
          vendedor_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contacts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_channels: {
        Row: {
          id: string;
          contact_id: string;
          channel_id: string;
          platform_sender_id: string;
          platform_username: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          contact_id: string;
          channel_id: string;
          platform_sender_id: string;
          platform_username?: string | null;
          created_at?: string;
        };
        Update: {
          platform_username?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contact_channels_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_channels_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      tags: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          color?: string | null;
          created_at?: string;
        };
        Update: {
          name?: string;
          color?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tags_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_tags: {
        Row: {
          contact_id: string;
          tag_id: string;
          created_at: string;
        };
        Insert: {
          contact_id: string;
          tag_id: string;
          created_at?: string;
        };
        Update: {
          contact_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      custom_field_definitions: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          slug: string;
          type: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          slug: string;
          type: string;
          created_at?: string;
        };
        Update: {
          name?: string;
          slug?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "custom_field_definitions_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_custom_fields: {
        Row: {
          contact_id: string;
          field_id: string;
          value: string;
          updated_at: string;
        };
        Insert: {
          contact_id: string;
          field_id: string;
          value: string;
          updated_at?: string;
        };
        Update: {
          value?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contact_custom_fields_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_custom_fields_field_id_fkey";
            columns: ["field_id"];
            isOneToOne: false;
            referencedRelation: "custom_field_definitions";
            referencedColumns: ["id"];
          },
        ];
      };
      flow_versions: {
        Row: {
          id: string;
          flow_id: string;
          version: number;
          nodes: Json;
          edges: Json;
          viewport: Json | null;
          name: string;
          published_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          flow_id: string;
          version: number;
          nodes: Json;
          edges: Json;
          viewport?: Json | null;
          name: string;
          published_by?: string | null;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [
          {
            foreignKeyName: "flow_versions_flow_id_fkey";
            columns: ["flow_id"];
            isOneToOne: false;
            referencedRelation: "flows";
            referencedColumns: ["id"];
          },
        ];
      };
      flows: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          status: FlowStatus;
          nodes: Json;
          edges: Json;
          viewport: Json | null;
          version: number;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          description?: string | null;
          status?: FlowStatus;
          nodes?: Json;
          edges?: Json;
          viewport?: Json | null;
          version?: number;
          published_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          status?: FlowStatus;
          nodes?: Json;
          edges?: Json;
          viewport?: Json | null;
          version?: number;
          published_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "flows_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      triggers: {
        Row: {
          id: string;
          flow_id: string;
          channel_id: string | null;
          type: TriggerType;
          config: Json;
          priority: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          flow_id: string;
          channel_id?: string | null;
          type: TriggerType;
          config?: Json;
          priority?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          channel_id?: string | null;
          type?: TriggerType;
          config?: Json;
          priority?: number;
          is_active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "triggers_flow_id_fkey";
            columns: ["flow_id"];
            isOneToOne: false;
            referencedRelation: "flows";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "triggers_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      flow_sessions: {
        Row: {
          id: string;
          contact_id: string;
          flow_id: string;
          channel_id: string;
          status: FlowSessionStatus;
          current_node_id: string | null;
          variables: Json;
          flow_stack: Json;
          waiting_until: string | null;
          waiting_for_input: boolean;
          human_takeover_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          contact_id: string;
          flow_id: string;
          channel_id: string;
          status?: FlowSessionStatus;
          current_node_id?: string | null;
          variables?: Json;
          flow_stack?: Json;
          waiting_until?: string | null;
          waiting_for_input?: boolean;
          human_takeover_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: FlowSessionStatus;
          current_node_id?: string | null;
          variables?: Json;
          flow_stack?: Json;
          waiting_until?: string | null;
          waiting_for_input?: boolean;
          human_takeover_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "flow_sessions_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "flow_sessions_flow_id_fkey";
            columns: ["flow_id"];
            isOneToOne: false;
            referencedRelation: "flows";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "flow_sessions_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          id: string;
          workspace_id: string;
          channel_id: string;
          contact_id: string;
          late_conversation_id: string | null;
          platform: Platform;
          status: ConversationStatus;
          assigned_to: string | null;
          last_message_at: string | null;
          last_message_preview: string | null;
          unread_count: number;
          is_automation_paused: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          channel_id: string;
          contact_id: string;
          late_conversation_id?: string | null;
          platform: Platform;
          status?: ConversationStatus;
          assigned_to?: string | null;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          unread_count?: number;
          is_automation_paused?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          late_conversation_id?: string | null;
          status?: ConversationStatus;
          assigned_to?: string | null;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          unread_count?: number;
          is_automation_paused?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          direction: MessageDirection;
          text: string | null;
          attachments: Json | null;
          quick_reply_payload: string | null;
          postback_payload: string | null;
          callback_data: string | null;
          platform_message_id: string | null;
          sent_by_flow_id: string | null;
          sent_by_node_id: string | null;
          sent_by_user_id: string | null;
          status: MessageStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          direction: MessageDirection;
          text?: string | null;
          attachments?: Json | null;
          quick_reply_payload?: string | null;
          postback_payload?: string | null;
          callback_data?: string | null;
          platform_message_id?: string | null;
          sent_by_flow_id?: string | null;
          sent_by_node_id?: string | null;
          sent_by_user_id?: string | null;
          status?: MessageStatus;
          created_at?: string;
        };
        Update: {
          status?: MessageStatus;
          platform_message_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcasts: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          status: BroadcastStatus;
          message_content: Json;
          segment_filter: Json | null;
          scheduled_for: string | null;
          total_recipients: number;
          sent: number;
          delivered: number;
          failed: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          status?: BroadcastStatus;
          message_content: Json;
          segment_filter?: Json | null;
          scheduled_for?: string | null;
          total_recipients?: number;
          sent?: number;
          delivered?: number;
          failed?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          status?: BroadcastStatus;
          message_content?: Json;
          segment_filter?: Json | null;
          scheduled_for?: string | null;
          total_recipients?: number;
          sent?: number;
          delivered?: number;
          failed?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "broadcasts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcast_recipients: {
        Row: {
          id: string;
          broadcast_id: string;
          contact_id: string;
          channel_id: string;
          status: string;
          sent_at: string | null;
          error_message: string | null;
        };
        Insert: {
          id?: string;
          broadcast_id: string;
          contact_id: string;
          channel_id: string;
          status?: string;
          sent_at?: string | null;
          error_message?: string | null;
        };
        Update: {
          status?: string;
          sent_at?: string | null;
          error_message?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey";
            columns: ["broadcast_id"];
            isOneToOne: false;
            referencedRelation: "broadcasts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcast_recipients_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcast_recipients_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      scheduled_jobs: {
        Row: {
          id: string;
          type: string;
          payload: Json;
          run_at: string;
          status: JobStatus;
          attempts: number;
          last_error: string | null;
          claimed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          type: string;
          payload: Json;
          run_at: string;
          status?: JobStatus;
          attempts?: number;
          last_error?: string | null;
          claimed_at?: string | null;
          created_at?: string;
        };
        Update: {
          status?: JobStatus;
          attempts?: number;
          last_error?: string | null;
          claimed_at?: string | null;
        };
        Relationships: [];
      };
      analytics_events: {
        Row: {
          id: string;
          workspace_id: string;
          flow_id: string | null;
          contact_id: string | null;
          event_type: string;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          flow_id?: string | null;
          contact_id?: string | null;
          event_type: string;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          workspace_id?: string;
          flow_id?: string | null;
          contact_id?: string | null;
          event_type?: string;
          metadata?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "analytics_events_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_invites: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          role: string;
          invited_by: string;
          status: string;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          email: string;
          role?: string;
          invited_by: string;
          status?: string;
          created_at?: string;
          expires_at?: string;
        };
        Update: {
          email?: string;
          role?: string;
          status?: string;
          expires_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      comment_logs: {
        Row: {
          id: string;
          channel_id: string;
          workspace_id: string;
          post_id: string | null;
          platform_comment_id: string;
          author_id: string | null;
          author_name: string | null;
          author_username: string | null;
          comment_text: string;
          matched_trigger_id: string | null;
          dm_sent: boolean;
          reply_sent: boolean;
          error: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          channel_id: string;
          workspace_id: string;
          post_id?: string | null;
          platform_comment_id: string;
          author_id?: string | null;
          author_name?: string | null;
          author_username?: string | null;
          comment_text: string;
          matched_trigger_id?: string | null;
          dm_sent?: boolean;
          reply_sent?: boolean;
          error?: string | null;
          created_at?: string;
        };
        Update: {
          matched_trigger_id?: string | null;
          dm_sent?: boolean;
          reply_sent?: boolean;
          error?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "comment_logs_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comment_logs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comment_logs_matched_trigger_id_fkey";
            columns: ["matched_trigger_id"];
            isOneToOne: false;
            referencedRelation: "triggers";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_events: {
        Row: {
          event_id: string;
          received_at: string;
        };
        Insert: {
          event_id: string;
          received_at?: string;
        };
        Update: {
          received_at?: string;
        };
        Relationships: [];
      };
      /**
       * Condiciones abiertas del receptor de webhooks: una fila por condición
       * con su contador, no una por evento. Se escribe solo por las funciones
       * `record_webhook_alert` y `resolve_webhook_alert` (migración 00022).
       */
      webhook_alerts: {
        Row: {
          id: string;
          /** Nulo en las alertas de sistema, que no tienen workspace al que atribuirse */
          workspace_id: string | null;
          channel_id: string | null;
          source: string;
          alert_condition: WebhookAlertCondition;
          /** Motivo corto. Nunca el cuerpo del aviso ni credenciales */
          detail: string | null;
          occurrences: number;
          first_seen_at: string;
          last_seen_at: string;
          /** Nulo mientras la condición está abierta */
          resolved_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "webhook_alerts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "webhook_alerts_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      integration_configs: {
        Row: {
          id: string;
          workspace_id: string;
          tipo: IntegrationTipo;
          proveedor: string;
          nombre: string;
          orden: number;
          /** Datos no secretos, como el modelo por defecto. Nunca una clave */
          config: Json;
          estado: IntegrationEstado;
          verificado_el: string | null;
          /** Motivo corto en lenguaje claro. Nunca una clave ni el cuerpo de una respuesta */
          ultimo_error: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          tipo: IntegrationTipo;
          proveedor: string;
          nombre: string;
          orden?: number;
          config?: Json;
          estado?: IntegrationEstado;
          verificado_el?: string | null;
          ultimo_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          nombre?: string;
          orden?: number;
          config?: Json;
          estado?: IntegrationEstado;
          verificado_el?: string | null;
          ultimo_error?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "integration_configs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      sequences: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          status: SequenceStatus;
          steps: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          name: string;
          description?: string | null;
          status?: SequenceStatus;
          steps?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          status?: SequenceStatus;
          steps?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sequences_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      sequence_enrollments: {
        Row: {
          id: string;
          sequence_id: string;
          contact_id: string;
          channel_id: string;
          current_step_index: number;
          status: SequenceEnrollmentStatus;
          enrolled_at: string;
          next_step_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          sequence_id: string;
          contact_id: string;
          channel_id: string;
          current_step_index?: number;
          status?: SequenceEnrollmentStatus;
          enrolled_at?: string;
          next_step_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          current_step_index?: number;
          status?: SequenceEnrollmentStatus;
          next_step_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sequence_enrollments_sequence_id_fkey";
            columns: ["sequence_id"];
            isOneToOne: false;
            referencedRelation: "sequences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sequence_enrollments_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sequence_enrollments_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      increment_unread: {
        Args: {
          conv_id: string;
          preview: string;
        };
        Returns: undefined;
      };
      increment_broadcast_sent: {
        Args: {
          b_id: string;
        };
        Returns: undefined;
      };
      increment_broadcast_failed: {
        Args: {
          b_id: string;
        };
        Returns: undefined;
      };
      /**
       * Supabase Vault (00018_vault_setup.sql). No se llaman directo: el acceso
       * pasa por lib/vault.ts, que es el único lugar que lee o escribe claves.
       */
      store_secret: {
        Args: {
          secret_name: string;
          secret_value: string;
          workspace_id: string;
        };
        /** id del secret en vault.secrets */
        Returns: string;
      };
      read_secret: {
        Args: {
          secret_name: string;
          workspace_id: string;
        };
        /** null cuando el secret no está configurado */
        Returns: string | null;
      };
      delete_secret: {
        Args: {
          secret_name: string;
          workspace_id: string;
        };
        /** true si había algo para borrar */
        Returns: boolean;
      };
      is_workspace_manager: {
        Args: {
          ws_id: string;
        };
        Returns: boolean;
      };
      record_webhook_alert: {
        Args: {
          p_source: string;
          p_condition: WebhookAlertCondition;
          p_workspace_id?: string | null;
          p_channel_id?: string | null;
          p_detail?: string | null;
        };
        /** Id de la condición abierta, sea nueva o la que ya estaba */
        Returns: string;
      };
      resolve_webhook_alert: {
        Args: {
          p_source: string;
          p_condition: WebhookAlertCondition;
          p_workspace_id?: string | null;
          p_detail_match?: string | null;
        };
        /** Cuántas condiciones cerró. 0 significa que no había ninguna abierta */
        Returns: number;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
