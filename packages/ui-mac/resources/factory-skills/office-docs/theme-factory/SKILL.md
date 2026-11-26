---
name: codepuppy-document-theme-factory
description: Toolkit for styling artifacts with a theme. These artifacts can be slides, docs, reportings, HTML landing pages, etc. There are 10 pre-set themes with colors/fonts that you can apply to any artifact that has been creating, or can generate a new theme on-the-fly.
license: Complete terms in LICENSE.txt
---

> Code Puppy adaptation, 2026-11-26. Derived from Anthropic skills @ e4bb5d960d87126ff3b3a8af1a104b7db67560ba; see LICENSE.txt and ../document-skills.lock.json for source and changes.

Read [the document workflow](../WORKFLOW.md) before making or checking a file.


# Theme Factory Skill

This skill provides a curated collection of professional font and color themes themes, each with carefully selected color palettes and font pairings. Once a theme is chosen, it can be applied to any artifact.

## Purpose

To apply consistent, professional styling to presentation slide decks, use this skill. Each theme includes:
- A cohesive color palette with hex codes
- Complementary font pairings for headers and body text
- A distinct visual identity suitable for different contexts and audiences

## Use the existing style authority

The user's template or supplied sample takes precedence. Otherwise start from the application's bundled Chinese template; these palettes are optional styling guidance when the request calls for a theme or adjustment. Choose an appropriate palette using the brief without requiring a showcase, theme selection or confirmation. Preserve a template's masters/theme rather than rebuilding a lookalike.

## Themes Available

The following 10 themes are available, described in their local theme files:

1. **[Ocean Depths](themes/ocean-depths.md)** - Professional and calming maritime theme
2. **[Sunset Boulevard](themes/sunset-boulevard.md)** - Warm and vibrant sunset colors
3. **[Forest Canopy](themes/forest-canopy.md)** - Natural and grounded earth tones
4. **[Modern Minimalist](themes/modern-minimalist.md)** - Clean and contemporary grayscale
5. **[Golden Hour](themes/golden-hour.md)** - Rich and warm autumnal palette
6. **[Arctic Frost](themes/arctic-frost.md)** - Cool and crisp winter-inspired theme
7. **[Desert Rose](themes/desert-rose.md)** - Soft and sophisticated dusty tones
8. **[Tech Innovation](themes/tech-innovation.md)** - Bold and modern tech aesthetic
9. **[Botanical Garden](themes/botanical-garden.md)** - Fresh and organic garden colors
10. **[Midnight Galaxy](themes/midnight-galaxy.md)** - Dramatic and cosmic deep tones

## Theme Details

Each theme is defined in the `themes/` directory with complete specifications including:
- Cohesive color palette with hex codes
- Complementary font pairings for headers and body text
- Distinct visual identity suitable for different contexts and audiences

## Application Process

After choosing a theme consistent with the request:
1. Read the corresponding theme file from the `themes/` directory
2. Apply the specified colors and fonts consistently throughout the deck
3. Ensure proper contrast and readability
4. Maintain the theme's visual identity across all slides

## Create your Own Theme
To handle cases where none of the existing themes work for an artifact, create a custom theme. Based on provided inputs, generate a new theme similar to the ones above. Give the theme a similar name describing what the font/color combinations represent. Use any basic description provided to choose appropriate colors/fonts. Apply it directly, then render and visually review through the document workflow. Summarize the result without adding an approval stage.

## Chinese fonts and actual files

The theme files retain their upstream palettes but use bundled Noto Sans SC for headings and Noto Serif SC for body text. Match user/template fonts when supplied. Apply fonts consistently to eastAsia and theme/run settings, not only Latin text. Use `codepuppy-document-pptx`, `codepuppy-document-docx`, `codepuppy-document-xlsx`, `codepuppy-document-pdf` or `codepuppy-document-frontend-design` to produce the actual format and perform its full visual review.
