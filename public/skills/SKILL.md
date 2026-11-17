# Plexo AI Agent Skill & Design Guidelines

Use this skill when generating landing pages and email templates for **Plexo**.

## Core Concept
Plexo renders high-converting landing pages using a structured `designJson` representation. When the user asks to generate and publish a page, produce a valid `designJson` object and submit it to Plexo's `/api/v1/publish` endpoint.

---

## Schema Structure (`designJson`)

A Plexo landing page contains a `body` with global styling tokens and an array of `rows`.

```json
{
  "body": {
    "style": {
      "background": "#0b0f19",
      "fontFamily": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      "padding": "0px",
      "htmlTitle": "Your Product - Elevate Your Workflow"
    },
    "rows": [
      {
        "id": "row_hero",
        "style": {
          "paddingTop": "60px",
          "paddingBottom": "60px",
          "backgroundColor": "#0b0f19"
        },
        "columns": [
          {
            "id": "col_hero_1",
            "width": "100%",
            "styles": {
              "textAlign": "center"
            },
            "elements": [
              {
                "id": "elem_hero_title",
                "type": "heading",
                "style": {
                  "color": "#ffffff",
                  "fontSize": "48px",
                  "fontWeight": "800",
                  "lineHeight": "1.2",
                  "textAlign": "center"
                },
                "attributes": {
                  "text": "Build Landing Pages at Light Speed"
                }
              },
              {
                "id": "elem_hero_desc",
                "type": "paragraph",
                "style": {
                  "color": "#94a3b8",
                  "fontSize": "18px",
                  "textAlign": "center"
                },
                "attributes": {
                  "text": "Empower your product with instant high-converting landing pages. Built for modern teams."
                }
              },
              {
                "id": "elem_hero_cta",
                "type": "button",
                "style": {
                  "backgroundColor": "#8b5cf6",
                  "color": "#ffffff",
                  "paddingTop": "14px",
                  "paddingBottom": "14px",
                  "paddingLeft": "28px",
                  "paddingRight": "28px",
                  "borderRadius": "12px",
                  "fontSize": "16px",
                  "fontWeight": "700",
                  "textAlign": "center"
                },
                "attributes": {
                  "text": "Get Started Free →",
                  "href": "#pricing"
                }
              }
            ]
          }
        ]
      }
    ]
  }
}
```

---

## Supported Element Types & Attributes

1. **`heading`**: `attributes: { text: string }`, `style: { color, fontSize, fontWeight, textAlign }`
2. **`paragraph`**: `attributes: { text: string }`, `style: { color, fontSize, lineHeight, textAlign }`
3. **`button`**: `attributes: { text: string, href: string, openInNewTab?: boolean }`, `style: { backgroundColor, color, borderRadius, paddingTop, paddingBottom, paddingLeft, paddingRight, fontSize, fontWeight, textAlign }`
4. **`image`**: `attributes: { src: string, alt: string }`, `style: { width, borderRadius, textAlign }`
5. **`card`**: `attributes: { title: string, description: string }`, `style: { backgroundColor, padding, borderRadius, border }`
6. **`form_container`**: `attributes: { formName: string, submitLabel: string, fields: Array<{ name, label, kind, placeholder, required }> }`
7. **`social`**: `attributes: { links: Array<{ provider: 'x'|'facebook'|'instagram'|'linkedin'|'youtube'|'github', url: string }> }`
8. **`spacer`**: `style: { height: '24px' }`
9. **`divider`**: `style: { borderWidth: '1px', borderColor: '#334155' }`

---

## Brand first (read this before choosing any colours)
A site can have a brand: a linked **Strata** project (Charisol's design-system tool) that stays in sync automatically, or the colours and logo saved on the site. Precedence: linked Strata project, then the site's saved brand, then the account's onboarding brand.
- Before you create or change anything for a site, call `get_site_brand` (MCP) and use what it returns (colours with roles, fonts, radius, logo) instead of the example colours below, even when the user never mentions their brand. Never ask for colours, fonts or a logo while a brand exists. Say once: "I'll use your <brand> brand."
- Read it again on every task: a change published in Strata shows up in the next call.
- `site_create` and the visual-editor tools default to the site's brand when you pass no colours or fonts. For a new site, `list_strata_projects` then `link_site_brand` (or `strataProjectId` on `site_create`) uses one of the owner's Strata brands; `create_strata_project_from_brand` keeps a site's current brand in Strata.
- REST equivalents: `GET/POST/PATCH/DELETE /api/v1/sites/{id}/brand`, `GET /api/v1/strata/projects`.

## Best Practices
- **Brand overrides the defaults.** The colours listed here are only for a site that has no brand at all.
- **Design Tokens**: Use vibrant, dark-mode sleek aesthetics (backgrounds: `#0b0f19`, `#111827`, accent: `#8b5cf6`, text: `#ffffff`, secondary text: `#94a3b8`).
- **Structure**: Always divide into Hero -> Key Benefits / Features Grid -> Testimonial/Social Proof -> Pricing -> CTA Form -> Footer.
- **Publishing**: When user prompts to publish, call `publishLandingPage` tool with `domain: "<slug>"`.
