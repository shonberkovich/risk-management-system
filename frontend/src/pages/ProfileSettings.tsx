import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DeleteIcon from "@mui/icons-material/Delete";
import FilterAltIcon from "@mui/icons-material/FilterAlt";
import SaveIcon from "@mui/icons-material/Save";
import SettingsIcon from "@mui/icons-material/Settings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";

import {
  createEmailRule,
  deleteEmailRule,
  fetchEmailRules,
  fetchLabels,
  type EmailRule,
  type EmailRuleAction,
  type EmailRuleActionType,
  type EmailRuleCondition,
  type EmailRuleConditionField,
  type EmailRuleConditionOperator,
  type Label,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS } from "../format";

/** TODO_SPEC.md "משימה 14" step 2 — minimal self-service "Profile Settings" screen.
 * No such page existed before this task (checked frontend/src/pages/ for anything
 * self-service like "MyProfile"/"Settings"/"Account" — none found), so this is the
 * first one; kept intentionally small (just the signature editor this task needs)
 * rather than growing into a general account-settings page nothing else asks for yet.
 *
 * Signature editor: same plain multiline TextField approach EmailComposeModal.tsx
 * settled on for its own body field (Task 8) — no rich-text editor dependency in
 * this project, so free-form HTML authoring isn't offered here either. The value
 * typed here is sent as-is to `PATCH /api/users/{id}/signature`, which sanitizes it
 * server-side (services/email.sanitize_body_html, same allow-list as email bodies)
 * before storing it — this screen doesn't need to (and doesn't try to) sanitize
 * client-side. */
export default function ProfileSettings() {
  const { user, updateSignature } = useAuth();
  const [signature, setSignature] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);

  // Load the current signature into the editor once the user is known. Does not
  // re-run on every render — only when the underlying value actually changes (e.g.
  // after a save) — so it doesn't clobber text the user is mid-typing.
  useEffect(() => {
    setSignature(user?.signature ?? "");
  }, [user?.signature]);

  const dirty = signature !== (user?.signature ?? "");

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateSignature(signature.trim() === "" ? null : signature);
      setSavedOpen(true);
    } catch {
      setError("שמירת החתימה נכשלה. נסו שוב.");
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return <Alert severity="error">יש להתחבר כדי לצפות בהגדרות הפרופיל.</Alert>;
  }

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <SettingsIcon color="primary" fontSize="large" />
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            הגדרות פרופיל
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {user.full_name} · {ROLE_LABELS[user.role] ?? user.role}
          </Typography>
        </Box>
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                חתימת מייל אישית
              </Typography>
              <Typography variant="caption" color="text.secondary">
                תצורף אוטומטית לתחתית כל מייל חדש שתכתבו. בתגובות, החתימה תופיע מעל ההודעה
                המצוטטת ולא תוכפל בפתיחה חוזרת של החלון.
              </Typography>
            </Box>

            <TextField
              label="חתימה"
              fullWidth
              multiline
              minRows={4}
              disabled={saving}
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder={"לדוגמה:\nישראל ישראלי\nמנהל סיכונים, RMIS"}
              slotProps={{ htmlInput: { "data-testid": "signature-textfield" } }}
            />

            {error && <Alert severity="error">{error}</Alert>}

            <Stack direction="row" justifyContent="flex-end">
              <Button
                variant="contained"
                startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon fontSize="small" />}
                disabled={!dirty || saving}
                onClick={handleSave}
                data-testid="save-signature-button"
              >
                שמירה
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <EmailRulesSection />

      <Snackbar
        open={savedOpen}
        autoHideDuration={3000}
        onClose={() => setSavedOpen(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="success" variant="filled" icon={<CheckCircleIcon fontSize="small" />}>
          החתימה נשמרה בהצלחה.
        </Alert>
      </Snackbar>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Email Rules / Filters (TODO_SPEC.md "משימה 17" step 3 — "פיתוח ממשק הגדרות
// המאפשר להרכיב חוק באמצעות תפריטים קופצים (If [Condition] Then [Action])").
// Lives in this same file/page rather than a standalone screen — the task's
// own instructions call for reusing ProfileSettings.tsx "if there's room to
// add a section", and a modest If/Then builder plus a flat rule list fits as
// one more Card here without duplicating this page's header/layout shell.
// Not a drag-and-drop or fully dynamic rule builder (spec step 3's own
// wording only asks for pop-up-menu pickers) — a plain form with "add
// condition"/"add action" buttons, mirroring EmailSidebar.tsx's
// CreateLabelForm for the create-then-invalidate react-query pattern this
// codebase already uses for Task 16's Labels CRUD.
// ---------------------------------------------------------------------------

const CONDITION_FIELD_LABELS: Record<EmailRuleConditionField, string> = {
  subject: "נושא",
  sender: "שולח (כתובת אימייל)",
  body: "גוף ההודעה",
};

const CONDITION_OPERATOR_LABELS: Record<EmailRuleConditionOperator, string> = {
  contains: "מכיל",
  equals: "שווה בדיוק ל",
};

const ACTION_TYPE_LABELS: Record<EmailRuleActionType, string> = {
  add_label: "הוסף תגית",
  move_to_folder: "העבר לתיקייה",
  mark_as_read: "סמן כנקרא",
};

// Mirrors backend/app/services/email_rules.py's _VALID_FOLDERS — SENT is
// deliberately excluded, same as the backend: a rule only ever acts on
// incoming mail, so "move to SENT" is never a meaningful target.
const RULE_TARGET_FOLDERS: { value: string; label: string }[] = [
  { value: "INBOX", label: "דואר נכנס" },
  { value: "ARCHIVE", label: "ארכיון" },
  { value: "TRASH", label: "אשפה (מעבר ישיר לאשפה)" },
  { value: "SPAM", label: "דואר זבל" },
];

interface ConditionDraft {
  field: EmailRuleConditionField;
  operator: EmailRuleConditionOperator;
  value: string;
}

interface ActionDraft {
  type: EmailRuleActionType;
  value: string;
}

const emptyCondition = (): ConditionDraft => ({ field: "subject", operator: "contains", value: "" });
const emptyAction = (): ActionDraft => ({ type: "mark_as_read", value: "" });

function summarizeCondition(condition: EmailRuleCondition): string {
  return `${CONDITION_FIELD_LABELS[condition.field]} ${CONDITION_OPERATOR_LABELS[condition.operator]} "${condition.value}"`;
}

function summarizeAction(action: EmailRuleAction, labels: Label[]): string {
  if (action.type === "add_label") {
    const label = labels.find((l) => String(l.id) === action.value);
    return `הוסף תגית "${label?.name ?? action.value ?? ""}"`;
  }
  if (action.type === "move_to_folder") {
    const folder = RULE_TARGET_FOLDERS.find((f) => f.value === action.value);
    return `העבר לתיקייה "${folder?.label ?? action.value ?? ""}"`;
  }
  return ACTION_TYPE_LABELS.mark_as_read;
}

/** One saved rule's read-only card: an "אם ... אז ..." summary built from its
 * conditions/actions (see summarizeCondition/summarizeAction), an active/
 * inactive chip, and a delete button. No edit affordance — Task 17's own
 * checklist only asks for create/list/delete plus the fixed action set,
 * never in-place editing. */
function RuleItem({ rule, labels, onDelete, deleting }: { rule: EmailRule; labels: Label[]; onDelete: () => void; deleting: boolean }) {
  return (
    <Card variant="outlined" data-testid={`rule-item-${rule.id}`}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {rule.name}
              </Typography>
              <Chip
                size="small"
                label={rule.is_active ? "פעיל" : "לא פעיל"}
                color={rule.is_active ? "success" : "default"}
                variant={rule.is_active ? "filled" : "outlined"}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              אם {rule.conditions.map(summarizeCondition).join(" וגם ")}
              <br />
              אז {rule.actions.map((a) => summarizeAction(a, labels)).join(", ")}
            </Typography>
          </Box>
          <IconButton
            size="small"
            aria-label={`מחיקת כלל ${rule.name}`}
            data-testid={`delete-rule-${rule.id}`}
            onClick={onDelete}
            disabled={deleting}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      </CardContent>
    </Card>
  );
}

function EmailRulesSection() {
  const queryClient = useQueryClient();
  const rulesQuery = useQuery({ queryKey: ["email-rules"], queryFn: fetchEmailRules });
  const labelsQuery = useQuery({ queryKey: ["labels"], queryFn: fetchLabels });
  const labels = labelsQuery.data ?? [];

  const [name, setName] = useState("");
  const [conditions, setConditions] = useState<ConditionDraft[]>([emptyCondition()]);
  const [actions, setActions] = useState<ActionDraft[]>([emptyAction()]);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setConditions([emptyCondition()]);
    setActions([emptyAction()]);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createEmailRule({
        name: name.trim(),
        conditions: conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value.trim() })),
        actions: actions.map((a) => ({ type: a.type, value: a.type === "mark_as_read" ? null : a.value.trim() })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-rules"] });
      resetForm();
      setError(null);
    },
    onError: () => setError("יצירת הכלל נכשלה. נסו שוב."),
  });

  const deleteMutation = useMutation({
    mutationFn: (ruleId: number) => deleteEmailRule(ruleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["email-rules"] }),
  });

  const updateCondition = (index: number, patch: Partial<ConditionDraft>) =>
    setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const updateAction = (index: number, patch: Partial<ActionDraft>) =>
    setActions((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  const conditionsValid = conditions.every((c) => c.value.trim() !== "");
  const actionsValid = actions.every((a) => a.type === "mark_as_read" || a.value.trim() !== "");
  const canSave = name.trim() !== "" && conditionsValid && actionsValid && !createMutation.isPending;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <FilterAltIcon color="primary" fontSize="small" />
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                כללי סינון אוטומטיים למייל
              </Typography>
              <Typography variant="caption" color="text.secondary">
                הגדירו כלל: אם התנאים מתקיימים בהודעה נכנסת, בצעו את הפעולות אוטומטית — למשל
                "אם הנושא מכיל 'דחוף', הוסיפו תגית אדומה".
              </Typography>
            </Box>
          </Stack>

          <TextField
            label="שם הכלל"
            fullWidth
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            slotProps={{ htmlInput: { "data-testid": "rule-name-input" } }}
          />

          <Box>
            <Typography variant="caption" color="text.secondary">
              תנאים (כל התנאים חייבים להתקיים)
            </Typography>
            <Stack spacing={1} sx={{ mt: 0.5 }}>
              {conditions.map((condition, index) => (
                <Stack key={index} direction="row" spacing={1} alignItems="center">
                  <TextField
                    select
                    label="שדה"
                    size="small"
                    value={condition.field}
                    onChange={(e) => updateCondition(index, { field: e.target.value as EmailRuleConditionField })}
                    sx={{ minWidth: 140 }}
                    slotProps={{ htmlInput: { "data-testid": `rule-condition-field-${index}` } }}
                  >
                    {Object.entries(CONDITION_FIELD_LABELS).map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    label="אופרטור"
                    size="small"
                    value={condition.operator}
                    onChange={(e) => updateCondition(index, { operator: e.target.value as EmailRuleConditionOperator })}
                    sx={{ minWidth: 140 }}
                    slotProps={{ htmlInput: { "data-testid": `rule-condition-operator-${index}` } }}
                  >
                    {Object.entries(CONDITION_OPERATOR_LABELS).map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="ערך"
                    size="small"
                    fullWidth
                    value={condition.value}
                    onChange={(e) => updateCondition(index, { value: e.target.value })}
                    slotProps={{ htmlInput: { "data-testid": `rule-condition-value-${index}` } }}
                  />
                  <IconButton
                    size="small"
                    aria-label="הסרת תנאי"
                    data-testid={`remove-condition-${index}`}
                    disabled={conditions.length === 1}
                    onClick={() => setConditions((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
              <Button
                size="small"
                startIcon={<AddIcon fontSize="small" />}
                onClick={() => setConditions((prev) => [...prev, emptyCondition()])}
                data-testid="add-condition-button"
                sx={{ alignSelf: "flex-start" }}
              >
                הוספת תנאי
              </Button>
            </Stack>
          </Box>

          <Divider />

          <Box>
            <Typography variant="caption" color="text.secondary">
              פעולות (יבוצעו כולן כאשר התנאים מתקיימים)
            </Typography>
            <Stack spacing={1} sx={{ mt: 0.5 }}>
              {actions.map((action, index) => (
                <Stack key={index} direction="row" spacing={1} alignItems="center">
                  <TextField
                    select
                    label="סוג פעולה"
                    size="small"
                    value={action.type}
                    onChange={(e) => updateAction(index, { type: e.target.value as EmailRuleActionType, value: "" })}
                    sx={{ minWidth: 160 }}
                    slotProps={{ htmlInput: { "data-testid": `rule-action-type-${index}` } }}
                  >
                    {Object.entries(ACTION_TYPE_LABELS).map(([value, label]) => (
                      <MenuItem key={value} value={value}>
                        {label}
                      </MenuItem>
                    ))}
                  </TextField>

                  {action.type === "add_label" && (
                    <TextField
                      select
                      label="תגית"
                      size="small"
                      fullWidth
                      value={action.value}
                      onChange={(e) => updateAction(index, { value: e.target.value })}
                      slotProps={{ htmlInput: { "data-testid": `rule-action-value-${index}` } }}
                    >
                      {labels.map((label) => (
                        <MenuItem key={label.id} value={String(label.id)}>
                          {label.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}

                  {action.type === "move_to_folder" && (
                    <TextField
                      select
                      label="תיקיית יעד"
                      size="small"
                      fullWidth
                      value={action.value}
                      onChange={(e) => updateAction(index, { value: e.target.value })}
                      slotProps={{ htmlInput: { "data-testid": `rule-action-value-${index}` } }}
                    >
                      {RULE_TARGET_FOLDERS.map((folder) => (
                        <MenuItem key={folder.value} value={folder.value}>
                          {folder.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}

                  <IconButton
                    size="small"
                    aria-label="הסרת פעולה"
                    data-testid={`remove-action-${index}`}
                    disabled={actions.length === 1}
                    onClick={() => setActions((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
              <Button
                size="small"
                startIcon={<AddIcon fontSize="small" />}
                onClick={() => setActions((prev) => [...prev, emptyAction()])}
                data-testid="add-action-button"
                sx={{ alignSelf: "flex-start" }}
              >
                הוספת פעולה
              </Button>
            </Stack>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction="row" justifyContent="flex-end">
            <Button
              variant="contained"
              startIcon={createMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <SaveIcon fontSize="small" />}
              disabled={!canSave}
              onClick={() => createMutation.mutate()}
              data-testid="save-rule-button"
            >
              יצירת כלל
            </Button>
          </Stack>

          {rulesQuery.data && rulesQuery.data.length > 0 && (
            <>
              <Divider />
              <Stack spacing={1}>
                {rulesQuery.data.map((rule) => (
                  <RuleItem
                    key={rule.id}
                    rule={rule}
                    labels={labels}
                    onDelete={() => deleteMutation.mutate(rule.id)}
                    deleting={deleteMutation.isPending && deleteMutation.variables === rule.id}
                  />
                ))}
              </Stack>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
