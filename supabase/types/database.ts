export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_runs: {
        Row: {
          budget_exhausted: boolean
          conversation_id: string
          created_at: string
          error_class: string | null
          finished_at: string | null
          hint_skill_id: string | null
          id: string
          input: Json
          input_tokens: number | null
          latency_ms: number | null
          model: string
          output_tokens: number | null
          plan: Json | null
          resume_id: string
          resume_version_id: string | null
          selected_node_id: string | null
          skill_ids: string[]
          status: Database["public"]["Enums"]["run_status"]
          structural: boolean
        }
        Insert: {
          budget_exhausted?: boolean
          conversation_id: string
          created_at?: string
          error_class?: string | null
          finished_at?: string | null
          hint_skill_id?: string | null
          id?: string
          input?: Json
          input_tokens?: number | null
          latency_ms?: number | null
          model: string
          output_tokens?: number | null
          plan?: Json | null
          resume_id: string
          resume_version_id?: string | null
          selected_node_id?: string | null
          skill_ids?: string[]
          status?: Database["public"]["Enums"]["run_status"]
          structural?: boolean
        }
        Update: {
          budget_exhausted?: boolean
          conversation_id?: string
          created_at?: string
          error_class?: string | null
          finished_at?: string | null
          hint_skill_id?: string | null
          id?: string
          input?: Json
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string
          output_tokens?: number | null
          plan?: Json | null
          resume_id?: string
          resume_version_id?: string | null
          selected_node_id?: string | null
          skill_ids?: string[]
          status?: Database["public"]["Enums"]["run_status"]
          structural?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_resume_version_id_fkey"
            columns: ["resume_version_id"]
            isOneToOne: false
            referencedRelation: "resume_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          active_summary_id: string | null
          created_at: string
          id: string
          resume_id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active_summary_id?: string | null
          created_at?: string
          id?: string
          resume_id: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active_summary_id?: string | null
          created_at?: string
          id?: string
          resume_id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_active_summary_fk"
            columns: ["active_summary_id"]
            isOneToOne: false
            referencedRelation: "memory_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: true
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      job_targets: {
        Row: {
          company: string
          created_at: string
          id: string
          location: string | null
          raw_text: string
          requirements: Json
          source_url: string | null
          title: string
          user_id: string
        }
        Insert: {
          company?: string
          created_at?: string
          id?: string
          location?: string | null
          raw_text: string
          requirements?: Json
          source_url?: string | null
          title?: string
          user_id: string
        }
        Update: {
          company?: string
          created_at?: string
          id?: string
          location?: string | null
          raw_text?: string
          requirements?: Json
          source_url?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      memory_summaries: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          model: string
          source_from_seq: number
          source_to_seq: number
          summary: Json
          summary_text: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          model: string
          source_from_seq: number
          source_to_seq: number
          summary: Json
          summary_text: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          model?: string
          source_from_seq?: number
          source_to_seq?: number
          summary?: Json
          summary_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_summaries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          agent_run_id: string | null
          content: Json
          conversation_id: string
          created_at: string
          id: string
          metadata: Json
          role: Database["public"]["Enums"]["message_role"]
          seq: number
        }
        Insert: {
          agent_run_id?: string | null
          content: Json
          conversation_id: string
          created_at?: string
          id?: string
          metadata?: Json
          role: Database["public"]["Enums"]["message_role"]
          seq?: never
        }
        Update: {
          agent_run_id?: string | null
          content?: Json
          conversation_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          role?: Database["public"]["Enums"]["message_role"]
          seq?: never
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      resume_job_targets: {
        Row: {
          created_at: string
          is_origin: boolean
          job_target_id: string
          resume_id: string
        }
        Insert: {
          created_at?: string
          is_origin?: boolean
          job_target_id: string
          resume_id: string
        }
        Update: {
          created_at?: string
          is_origin?: boolean
          job_target_id?: string
          resume_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resume_job_targets_job_target_id_fkey"
            columns: ["job_target_id"]
            isOneToOne: false
            referencedRelation: "job_targets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_job_targets_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      resume_versions: {
        Row: {
          agent_run_id: string | null
          content: Json
          content_hash: string
          created_at: string
          created_by: Database["public"]["Enums"]["created_by_kind"]
          id: string
          label: string | null
          resume_id: string
          schema_version: number
          version_no: number
        }
        Insert: {
          agent_run_id?: string | null
          content: Json
          content_hash: string
          created_at?: string
          created_by: Database["public"]["Enums"]["created_by_kind"]
          id?: string
          label?: string | null
          resume_id: string
          schema_version: number
          version_no: number
        }
        Update: {
          agent_run_id?: string | null
          content?: Json
          content_hash?: string
          created_at?: string
          created_by?: Database["public"]["Enums"]["created_by_kind"]
          id?: string
          label?: string | null
          resume_id?: string
          schema_version?: number
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "resume_versions_agent_run_fk"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resume_versions_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      resumes: {
        Row: {
          created_at: string
          current_version_id: string | null
          data: Json
          deleted_at: string | null
          id: string
          revision: number
          schema_version: number
          subtitle: string
          template_id: string
          template_options: Json
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_version_id?: string | null
          data: Json
          deleted_at?: string | null
          id?: string
          revision?: number
          schema_version?: number
          subtitle?: string
          template_id?: string
          template_options?: Json
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_version_id?: string | null
          data?: Json
          deleted_at?: string | null
          id?: string
          revision?: number
          schema_version?: number
          subtitle?: string
          template_id?: string
          template_options?: Json
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "resumes_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "resume_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestions: {
        Row: {
          agent_run_id: string
          created_at: string
          decided_at: string | null
          id: string
          operation: Database["public"]["Enums"]["patch_op"]
          ordinal: number
          patch: Json
          resume_id: string
          status: Database["public"]["Enums"]["suggestion_status"]
          target_node_id: string
        }
        Insert: {
          agent_run_id: string
          created_at?: string
          decided_at?: string | null
          id?: string
          operation: Database["public"]["Enums"]["patch_op"]
          ordinal: number
          patch: Json
          resume_id: string
          status?: Database["public"]["Enums"]["suggestion_status"]
          target_node_id: string
        }
        Update: {
          agent_run_id?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          operation?: Database["public"]["Enums"]["patch_op"]
          ordinal?: number
          patch?: Json
          resume_id?: string
          status?: Database["public"]["Enums"]["suggestion_status"]
          target_node_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestions_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestions_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      user_disabled_skills: {
        Row: {
          created_at: string
          skill_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          skill_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          skill_id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_skills: {
        Row: {
          body: string
          category: string
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          name: string
          not_for: string | null
          starter: string | null
          updated_at: string
          user_id: string
          when_to_use: string | null
        }
        Insert: {
          body: string
          category?: string
          created_at?: string
          deleted_at?: string | null
          description: string
          id?: string
          name: string
          not_for?: string | null
          starter?: string | null
          updated_at?: string
          user_id: string
          when_to_use?: string | null
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          name?: string
          not_for?: string | null
          starter?: string | null
          updated_at?: string
          user_id?: string
          when_to_use?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_memory_summary: {
        Args: {
          p_conversation_id: string
          p_from_seq: number
          p_model: string
          p_summary: Json
          p_summary_text: string
          p_to_seq: number
        }
        Returns: {
          conversation_id: string
          created_at: string
          id: string
          model: string
          source_from_seq: number
          source_to_seq: number
          summary: Json
          summary_text: string
        }
        SetofOptions: {
          from: "*"
          to: "memory_summaries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_resume_version: {
        Args: {
          p_agent_run_id?: string
          p_content: Json
          p_content_hash: string
          p_created_by?: Database["public"]["Enums"]["created_by_kind"]
          p_dedupe?: boolean
          p_label?: string
          p_resume_id: string
          p_schema_version: number
        }
        Returns: Json
      }
      decide_suggestions: {
        Args: {
          p_content_hash?: string
          p_decisions: Json
          p_new_content?: Json
          p_run_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      created_by_kind: "user" | "agent" | "system"
      message_role: "user" | "assistant" | "system"
      patch_op:
        | "replace_text"
        | "update_fields"
        | "insert_after"
        | "delete"
        | "move"
      run_status: "running" | "completed" | "failed" | "cancelled"
      suggestion_status: "pending" | "accepted" | "rejected" | "stale"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      created_by_kind: ["user", "agent", "system"],
      message_role: ["user", "assistant", "system"],
      patch_op: [
        "replace_text",
        "update_fields",
        "insert_after",
        "delete",
        "move",
      ],
      run_status: ["running", "completed", "failed", "cancelled"],
      suggestion_status: ["pending", "accepted", "rejected", "stale"],
    },
  },
} as const

