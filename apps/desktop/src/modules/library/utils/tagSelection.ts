export function parseTagInput(value: string) {
  return [
    ...new Set(
      value
        .split(/[,;\n]/)
        .map((tag) =>
          tag
            .split('/')
            .map((part) => part.trim())
            .filter(Boolean)
            .join('/')
        )
        .filter(Boolean)
    )
  ];
}

export function normalizeSelectedTagPaths(paths: string[]) {
  return paths.reduce<string[]>((selected, path) => {
    if (selected.some((current) => isAncestorPath(path, current))) {
      return selected;
    }

    const withoutRelated = selected.filter(
      (current) =>
        !isAncestorPath(current, path) &&
        !isDescendantPath(current, path) &&
        !hasSameNonRootParent(current, path)
    );

    return [...withoutRelated, path];
  }, []);
}

export function isSiblingTagBlocked(path: string, selectedPaths: string[]) {
  return selectedPaths.some(
    (selectedPath) =>
      selectedPath !== path &&
      hasSameNonRootParent(selectedPath, path) &&
      !isAncestorPath(selectedPath, path) &&
      !isAncestorPath(path, selectedPath)
  );
}

function hasSameNonRootParent(left: string, right: string) {
  const leftParent = getParentPath(left);
  return leftParent.length > 0 && leftParent === getParentPath(right);
}

function isAncestorPath(ancestor: string, path: string) {
  return path !== ancestor && path.startsWith(`${ancestor}/`);
}

function isDescendantPath(descendant: string, path: string) {
  return isAncestorPath(path, descendant);
}

function getParentPath(path: string) {
  const parts = path.split('/');
  return parts.slice(0, -1).join('/');
}
