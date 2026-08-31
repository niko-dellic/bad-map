# Releasing bad-map

Stable releases are published from GitHub Actions with npm trusted publishing.
The configured publisher is repository `niko-dellic/bad-map`, workflow
`release.yml`, and GitHub environment `npm`. Do not store a long-lived npm token
in repository secrets.

Trusted publishing and npm provenance have been verified in production. Keep
the release workflow, repository identity, and `npm` environment aligned with
the trusted-publisher configuration; releases must not depend on a long-lived
npm token.

## Release checklist

1. Start from a clean, current default branch whose required CI jobs are green.
2. Update `package.json` and `package-lock.json` with
   `npm version --no-git-tag-version <version>`.
3. Move relevant notes from `Unreleased` under the new version in
   `CHANGELOG.md`, including migration notes for public API changes.
4. Run:

   ```sh
   npm ci
   npx playwright install chromium chrome firefox webkit
   npm run verify
   npm run test:e2e:functional
   npm pack --dry-run
   ```

5. Merge the release change and confirm the exact release commit is on `main`.
6. Create and publish a matching `v<version>` GitHub release. The workflow
   checks out that immutable tag, verifies it, and publishes through OIDC.
7. Confirm the GitHub workflow, npm version, provenance badge, tarball contents,
   install command, and browser quick start from a clean project.

Do not move an existing tag after publication. If a release workflow fails,
fix the problem on `main`, prepare a new version, and publish a new tag.

## Prereleases

Use a version such as `<next-version>-beta.0` and the npm `next` tag for an
external trial. Stable versions publish under `latest`. Confirm the intended
dist-tag after publishing.

## Publisher maintenance

- Keep the `npm` environment limited to the publish workflow and add an
  approval rule if release review is desired.
- Keep workflow permissions at `contents: read` and `id-token: write`.
- After the first successful trusted publication, configure npm to require 2FA
  and disallow bypass-token publishing, then revoke obsolete granular tokens.
- Treat changes to the workflow filename, repository name, owner, or GitHub
  environment as publisher configuration changes that must also be updated on
  npm.
