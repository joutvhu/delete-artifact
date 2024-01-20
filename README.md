# Delete Artifacts

This GitHub Action to delete artifacts from your build. This can be useful when you want to clean up artifacts that are no longer needed.

See also [upload-artifact](https://github.com/actions/upload-artifact).

## v2 - What's new

> [!IMPORTANT]
> delete-artifact@v2 is not currently supported on GHES yet. If you are on GHES, you must use [v1](https://github.com/joutvhu/delete-artifact/releases/tag/v1).

If the artifacts are uploaded using actions/upload-artifact@v3- then use joutvhu/delete-artifact@v1

If the artifacts are uploaded using actions/upload-artifact@v4+ then use joutvhu/delete-artifact@v2

## Usage

See [action.yml](action.yml)

## Delete a Single Artifact

```yaml
steps:
- uses: joutvhu/delete-artifact@v2
  with:
    name: my-artifact
```

## Delete Multiple Artifacts

Deleting multiple artifacts within a single action can be achieved by specifying each artifact name on a new line, this can improve performance when deleting more than one artifact.

```yaml
steps:
- uses: joutvhu/delete-artifact@v2
  with:
    name: |
      artifact-1
      artifact-2
```

## Delete All Artifacts

If you don't specify an artifact `name` this Action will be deleted all found artifacts

```yaml
steps:
- uses: joutvhu/delete-artifact@v2
```
