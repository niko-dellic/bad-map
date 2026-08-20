# Releasing bad-map

After the initial package bootstrap, releases are published from GitHub Actions
with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/). Do
not store a long-lived npm token in repository secrets.

## One-time setup

1. Enable npm two-factor authentication for publishing.
2. A trusted publisher can only be attached after the package exists. For the
   first release, sign in locally with `npm login`, complete the full release
   checklist below, and run `npm publish --access public` from the clean tagged
   commit. No registry token belongs in GitHub.
3. Add this repository's `release.yml` workflow as a trusted publisher in the
   npm package settings. Set the GitHub environment to `npm` and explicitly
   allow `npm publish`.
4. Protect the `npm` GitHub environment if release approval is desired.
5. Restrict or revoke token-based publishing after the trusted workflow has
   successfully published a later version.

## Release checklist

1. Start from a clean, current default branch.
2. Update the version in `package.json` and `package-lock.json` using
   `npm version --no-git-tag-version <version>`.
3. Move the relevant changelog notes under that version and verify links and
   dates.
4. Run:

   ```sh
   npm ci
   npx playwright install chromium chrome
   npm run verify
   npm run test:e2e:functional
   npm pack --dry-run
   ```

5. Merge the release change, create a matching `v<version>` GitHub release,
   and publish it. The release workflow verifies the exact tag before calling
   npm.
6. Confirm the npm page, package contents, provenance, install command, and
   browser quick start from a clean project.

For the bootstrap release, publish to npm before publishing the matching GitHub
release, then configure trusted publishing. The workflow recognizes that the
version already exists and does not publish it twice. Subsequent GitHub releases
publish through OIDC and receive npm provenance automatically.

Use a prerelease such as `0.9.0-beta.0` with the npm `next` tag for an external
trial. Stable versions publish under `latest`.
