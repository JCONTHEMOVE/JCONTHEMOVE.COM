// Called only behind marketingExecution's requireOwner middleware.
export function completeMarketingAction(query: (sql: string, values: any[]) => Promise<any>, id: string, proofUrl = '', proofNotes: string | null = null) {
  return query(`UPDATE marketing_action_assignments
    SET status = 'completed', proof_url = COALESCE(NULLIF($1, ''), proof_url),
        proof_notes = COALESCE($2, proof_notes), completed_at = NOW(), updated_at = NOW()
    WHERE id = $3 AND (action_key NOT LIKE 'crew-fall-2026:%' OR status = 'submitted')
    RETURNING *`, [proofUrl, proofNotes, id]);
}
