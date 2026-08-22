/**
 * TODO_SPEC.md "משימה 12" step 4/5 — {{variable}} substitution for
 * Email_Templates, run client-side (see routers/email_templates.py's module
 * docstring for the client-vs-server rationale). This module is deliberately
 * a plain `str.replace`-style loop over a small whitelist of known variable
 * names — never `.format()`/an f-string/`eval` — since both the template
 * text (an admin-authored but still free-text NVARCHAR column) and the
 * variable values (claim numbers, client names pulled from whatever entity
 * the compose modal was opened against) are effectively user-controlled data,
 * and `.format()`/eval-based substitution over untrusted input is an
 * injection risk (arbitrary attribute/index access via `{obj.__class__...}`-
 * style format specs, or arbitrary code execution for eval). A literal
 * `{{name}}` → value replace has no such surface: unknown placeholders are
 * simply left in the text as-is (never silently dropped — the compose form
 * stays editable so the user can hand-fill anything that wasn't resolved).
 */

/** The template placeholders this app knows how to fill automatically. Keep in
 * sync with whatever context callers of `applyEmailTemplate` can realistically
 * supply (see EmailComposeModal's `templateContext` prop) — an unlisted
 * `{{...}}` name is left untouched in the rendered text, not an error. */
export interface EmailTemplateVariables {
  claim_number?: string;
  client_name?: string;
  incident_code?: string;
  property_name?: string;
}

/** Replaces every `{{key}}` occurrence (whitespace around `key` is tolerated,
 * e.g. `{{ claim_number }}`) with `variables[key]` when it's set. A variable
 * that's absent or empty is left as the literal `{{key}}` placeholder in the
 * output — never silently blanked — so the user can see exactly what still
 * needs hand-filling before sending. */
export function substituteTemplateVariables(text: string, variables: EmailTemplateVariables): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    const value = (variables as Record<string, string | undefined>)[key];
    return value ? value : match;
  });
}

export interface RenderedEmailTemplate {
  subject: string;
  body: string;
}

/** Renders both the subject and body of `template` against `variables` in one
 * call — the shape EmailComposeModal's "use template" picker needs to fill
 * the subject/body TextFields it already owns. */
export function applyEmailTemplate(
  template: { subject_template: string; body_template: string },
  variables: EmailTemplateVariables,
): RenderedEmailTemplate {
  return {
    subject: substituteTemplateVariables(template.subject_template, variables),
    body: substituteTemplateVariables(template.body_template, variables),
  };
}
