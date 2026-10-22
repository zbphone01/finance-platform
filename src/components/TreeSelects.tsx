import { useDeferredValue, useMemo, useState } from "react";

function normalizeLabelName(value: string) {
  const trimmed = value.trim();
  const parts = trimmed.split("_");
  return parts.length > 1 ? parts.slice(1).join("_") : trimmed;
}

function buttonClass(hasError?: boolean) {
  return `w-full h-9 flex items-center justify-between rounded-md border bg-background px-3 text-sm text-left hover:bg-gray-50 disabled:opacity-50 overflow-hidden ${
    hasError ? "border-red-500" : "border-input"
  }`;
}

function searchInputClass() {
  return "w-full h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-blue-400";
}

// 部门树形选择：一级不可选；有三级组织的二级部门不可选，需选择其三级分组。
export function DeptTreeSelect({
  value,
  tree,
  onChange,
  placeholder,
  hasError,
  allowCustom = false,
}: {
  value: string;
  tree: any[];
  onChange: (val: string) => void;
  placeholder: string;
  hasError?: boolean;
  allowCustom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const displayValue = value || placeholder;

  const renderTree = (nodes: any[], depth = 0) =>
    nodes.map((node) => {
      const isLevel1 = node.level === 1;
      const childrenForRule = node.originalChildren || node.children || [];
      const hasChildren = childrenForRule.length > 0;
      const isSelectable = node.level === 3 || (node.level === 2 && !hasChildren);
      const indent = depth * 16;
      const displayText = `${node.code}_${node.name}`;

      return (
        <div key={node.id}>
          <div
            className={`flex items-center py-1.5 px-2 text-sm ${
              isSelectable ? "hover:bg-blue-50 cursor-pointer" : "text-gray-400 cursor-default"
            }`}
            style={{ paddingLeft: `${8 + indent}px` }}
            onClick={() => {
              if (isSelectable) {
                onChange(displayText);
                setOpen(false);
                setKeyword("");
              }
            }}
          >
            {node.children && node.children.length > 0 && <span className="text-gray-400 mr-1 text-xs">▼</span>}
            {isLevel1 && <span className="text-gray-400 mr-1 text-xs">├</span>}
            <span className={isLevel1 ? "font-medium text-gray-500" : ""}>{displayText}</span>
            {isLevel1 && <span className="text-xs text-gray-300 ml-1 shrink-0 whitespace-nowrap">(不可选)</span>}
            {node.level === 2 && hasChildren && (
              <span className="text-xs text-gray-300 ml-1 shrink-0 whitespace-nowrap">(有分组)</span>
            )}
          </div>
          {node.children && node.children.length > 0 && <div>{renderTree(node.children, depth + 1)}</div>}
        </div>
      );
    });

  const filteredTree = useMemo(() => {
    if (!open) return [];
    const text = deferredKeyword.trim().toLowerCase();
    if (!text) return tree;
    const filterTree = (nodes: any[]): any[] =>
      nodes
        .map((node) => {
          const children = filterTree(node.children || []);
          const displayText = `${node.code || ""}_${node.name || ""}`.toLowerCase();
          if (displayText.includes(text) || children.length > 0) {
            return { ...node, children, originalChildren: node.children || [] };
          }
          return null;
        })
        .filter(Boolean) as any[];
    return filterTree(tree);
  }, [deferredKeyword, open, tree]);

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className={buttonClass(hasError)}>
        <span className={`min-w-0 truncate ${value ? "text-gray-900" : "text-gray-400"}`} title={displayValue}>
          {displayValue}
        </span>
        <span className="text-gray-400 text-xs shrink-0 ml-2">▼</span>
      </button>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-[280px] overflow-auto">
          <div className="p-2 border-b">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索部门"
              className={searchInputClass()}
              autoFocus
            />
          </div>
          {allowCustom && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 border-b"
              onClick={() => {
                onChange("");
                setOpen(false);
                setKeyword("");
              }}
            >
              自定义部门
            </button>
          )}
          <div className="py-1">
            {tree.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">暂无部门数据</div>
            ) : filteredTree.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">无匹配部门</div>
            ) : (
              renderTree(filteredTree)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 部门树形多选：沿用单选规则，以勾选方式选择多个末级部门。
export function DeptTreeMultiSelect({
  values,
  tree,
  onChange,
  placeholder,
  disabled,
  excludedValues = [],
}: {
  values: string[];
  tree: any[];
  onChange: (values: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  excludedValues?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const selectedValues = useMemo(() => new Set(values), [values]);
  const excludedValueSet = useMemo(() => new Set(excludedValues.filter(Boolean)), [excludedValues]);
  const displayValue = values.length === 0
    ? placeholder
    : values.length === 1
      ? values[0]
      : `已选择 ${values.length} 个部门`;

  const renderTree = (nodes: any[], depth = 0) =>
    nodes.map((node) => {
      const isLevel1 = node.level === 1;
      const childrenForRule = node.originalChildren || node.children || [];
      const hasChildren = childrenForRule.length > 0;
      const canSelectByLevel = node.level === 3 || (node.level === 2 && !hasChildren);
      const indent = depth * 16;
      const displayText = `${node.code}_${node.name}`;
      const normalizedDisplayText = normalizeLabelName(displayText);
      const isExcluded = excludedValueSet.has(displayText)
        || excludedValues.some((value) => normalizeLabelName(value) === normalizedDisplayText);
      const isSelectable = canSelectByLevel && !isExcluded;
      const isSelected = selectedValues.has(displayText);

      return (
        <div key={node.id}>
          <div
            className={`flex items-center gap-2 py-1.5 px-2 text-sm ${
              isSelectable ? "hover:bg-blue-50 cursor-pointer" : "text-gray-400 cursor-default"
            } ${isSelected ? "bg-blue-50" : ""}`}
            style={{ paddingLeft: `${8 + indent}px` }}
            onClick={() => {
              if (!isSelectable) return;
              onChange(
                isSelected
                  ? values.filter((value) => value !== displayText)
                  : [...values, displayText],
              );
            }}
          >
            {canSelectByLevel ? (
              <input
                type="checkbox"
                checked={isSelected}
                readOnly
                disabled={isExcluded}
                className="h-4 w-4 shrink-0 accent-blue-600"
              />
            ) : (
              <span className="h-4 w-4 shrink-0 text-center text-xs text-gray-400">
                {node.children && node.children.length > 0 ? "▼" : ""}
              </span>
            )}
            {isLevel1 && <span className="text-gray-400 text-xs">├</span>}
            <span className={`min-w-0 truncate ${isLevel1 ? "font-medium text-gray-500" : ""}`} title={displayText}>
              {displayText}
            </span>
            {isLevel1 && <span className="text-xs text-gray-300 shrink-0 whitespace-nowrap">(不可选)</span>}
            {node.level === 2 && hasChildren && (
              <span className="text-xs text-gray-300 shrink-0 whitespace-nowrap">(有分组)</span>
            )}
            {isExcluded && <span className="text-xs text-gray-300 shrink-0 whitespace-nowrap">(当前部门)</span>}
          </div>
          {node.children && node.children.length > 0 && <div>{renderTree(node.children, depth + 1)}</div>}
        </div>
      );
    });

  const filteredTree = useMemo(() => {
    if (!open) return [];
    const text = deferredKeyword.trim().toLowerCase();
    if (!text) return tree;
    const filterTree = (nodes: any[]): any[] =>
      nodes
        .map((node) => {
          const children = filterTree(node.children || []);
          const displayText = `${node.code || ""}_${node.name || ""}`.toLowerCase();
          if (displayText.includes(text) || children.length > 0) {
            return { ...node, children, originalChildren: node.children || [] };
          }
          return null;
        })
        .filter(Boolean) as any[];
    return filterTree(tree);
  }, [deferredKeyword, open, tree]);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className={buttonClass()}
      >
        <span
          className={`min-w-0 truncate ${values.length > 0 ? "text-gray-900" : "text-gray-400"}`}
          title={values.length > 0 ? values.join("、") : displayValue}
        >
          {displayValue}
        </span>
        <span className="text-gray-400 text-xs shrink-0 ml-2">▼</span>
      </button>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg">
          <div className="p-2 border-b">
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索部门"
              className={searchInputClass()}
              autoFocus
            />
          </div>
          <div className="max-h-[230px] overflow-auto py-1">
            {tree.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">暂无部门数据</div>
            ) : filteredTree.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">无匹配部门</div>
            ) : (
              renderTree(filteredTree)
            )}
          </div>
          <div className="flex items-center justify-between border-t px-2 py-1.5">
            <button
              type="button"
              disabled={values.length === 0}
              className="text-xs text-gray-500 hover:text-red-500 disabled:text-gray-300"
              onClick={() => onChange([])}
            >
              清空
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
              onClick={() => {
                setOpen(false);
                setKeyword("");
              }}
            >
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 所属项目中心：只选择部门管理中 01 一级部门直属的二级部门。
export function ProjectCenterSelect({
  value,
  tree,
  onChange,
  placeholder,
  disabled,
  hasError,
}: {
  value: string;
  tree: any[];
  onChange: (val: string) => void;
  placeholder: string;
  disabled?: boolean;
  hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const displayValue = value || placeholder;
  const projectCenters = useMemo(() => {
    const root = tree.find((node) => node.code === "01" && node.level === 1);
    const items = (root?.children || []).filter((node: any) => node.level === 2 && node.parentCode === "01");
    const text = deferredKeyword.trim().toLowerCase();
    if (!text) return items;
    return items.filter((node: any) =>
      `${node.code || ""}_${node.name || ""}`.toLowerCase().includes(text)
    );
  }, [deferredKeyword, tree]);

  return (
    <div className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen(!open)} className={buttonClass(hasError)}>
        <span className={`min-w-0 truncate ${value ? "text-gray-900" : "text-gray-400"}`} title={displayValue}>
          {displayValue}
        </span>
        <span className="ml-2 shrink-0 text-xs text-gray-400">▼</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 max-h-[280px] w-full overflow-auto rounded-md border bg-white shadow-lg">
          <div className="border-b p-2">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索所属项目中心"
              className={searchInputClass()}
              autoFocus
            />
          </div>
          {value && (
            <button
              type="button"
              className="w-full border-b px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50"
              onClick={() => {
                onChange("");
                setOpen(false);
                setKeyword("");
              }}
            >
              清空选择
            </button>
          )}
          <div className="py-1">
            {disabled ? (
              <div className="py-4 text-center text-sm text-gray-400">加载中...</div>
            ) : projectCenters.length === 0 ? (
              <div className="py-4 text-center text-sm text-gray-400">
                {keyword.trim() ? "无匹配项目中心" : "01一级部门下暂无二级部门"}
              </div>
            ) : (
              projectCenters.map((node: any) => {
                const displayText = `${node.code}_${node.name}`;
                return (
                  <div
                    key={node.id}
                    className="cursor-pointer px-3 py-1.5 text-sm hover:bg-blue-50"
                    onClick={() => {
                      onChange(displayText);
                      setOpen(false);
                      setKeyword("");
                    }}
                  >
                    {displayText}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function deptValueMatches(value: string, incomeDept: string) {
  const deptName = normalizeLabelName(incomeDept);
  const normalizedValue = normalizeLabelName(value || "");
  return value === incomeDept || normalizedValue === deptName;
}

function deptMatches(node: any, incomeDept: string) {
  if (!incomeDept) return true;
  const nodeLabel = `${node.code || ""}_${node.name || ""}`;
  const values = [
    node.name || "",
    nodeLabel,
    ...normalizeProjectList(node.associatedDepartments),
  ];
  return values.some((value) => deptValueMatches(value, incomeDept));
}

function normalizeProjectList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function projectDisplayValue(node: any) {
  return `${node.code}_${node.name}`;
}

function getBudgetProjectValues(ncNode: any | null) {
  if (!ncNode) return [];
  return Array.from(new Set([ncNode.incomeProject || ncNode.name || "", ...normalizeProjectList(ncNode.associatedIncomeProjects)]))
    .filter(Boolean);
}

function getBudgetContextProjectValues(context: { node: any; ncNode: any | null } | null) {
  if (!context) return [];
  return Array.from(new Set([
    ...getBudgetProjectValues(context.ncNode),
    ...getBudgetProjectValues(context.node),
  ]));
}

function findBudgetContextByValue(nodes: any[], value: string, parentNc: any | null = null): { node: any; ncNode: any | null } | null {
  const code = value.split("-")[0];
  let fallback: { node: any; ncNode: any | null } | null = null;
  for (const node of nodes) {
    const currentNc = node.level === 2 ? node : parentNc;
    if (code && node.code === code && node.isLeaf === 1) return { node, ncNode: currentNc };
    if (code && node.code === code && !fallback) fallback = { node, ncNode: currentNc };
    if (node.children?.length) {
      const found = findBudgetContextByValue(node.children, value, currentNc);
      if (found) return found;
    }
  }
  return fallback;
}

// 预算编码树形选择：只选择预算明细 isLeaf=1，可按收入部门先筛选，再在结果内搜索。
export function BudgetCodeSelect({
  value,
  tree,
  incomeDept,
  onChange,
  placeholder,
  disabled,
  hasError,
}: {
  value: string;
  tree: any[];
  incomeDept?: string;
  onChange: (val: string, incomeProject: string | null, associatedIncomeProjects: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const displayValue = value || placeholder;

  const deptFilteredTree = useMemo(
    () => (open && incomeDept ? tree.filter((node) => deptMatches(node, incomeDept)) : tree),
    [incomeDept, open, tree],
  );

  const renderTree = (nodes: any[], depth = 0, parentNc: any | null = null) =>
    nodes.map((node) => {
      const isLeaf = node.isLeaf === 1 && node.code;
      const isCategory = !isLeaf;
      const indent = depth * 16;
      const displayText = isLeaf ? `${node.code}-${node.name}` : node.name;
      const currentNc = node.level === 2 ? node : parentNc;
      const autoProject = currentNc ? currentNc.incomeProject || currentNc.name || null : node.incomeProject || null;
      const associatedProjects = getBudgetProjectValues(currentNc).filter((project) => project !== autoProject);

      return (
        <div key={node.id}>
          <div
            className={`flex items-center py-1.5 px-2 text-sm ${
              isLeaf ? "hover:bg-blue-50 cursor-pointer" : "text-gray-400 cursor-default"
            }`}
            style={{ paddingLeft: `${8 + indent}px` }}
            onClick={() => {
              if (isLeaf) {
                onChange(displayText, autoProject, associatedProjects);
                setOpen(false);
                setKeyword("");
              }
            }}
          >
            {node.children && node.children.length > 0 && <span className="text-gray-400 mr-1 text-xs">▼</span>}
            {isCategory && <span className="text-gray-400 mr-1 text-xs">├</span>}
            <span className={isCategory ? "font-medium text-gray-500" : ""}>{displayText}</span>
            {isCategory && <span className="text-xs text-gray-300 ml-1 shrink-0 whitespace-nowrap">(分类)</span>}
          </div>
          {node.children && node.children.length > 0 && <div>{renderTree(node.children, depth + 1, currentNc)}</div>}
        </div>
      );
    });

  const filteredTree = useMemo(() => {
    if (!open) return [];
    const text = deferredKeyword.trim().toLowerCase();
    if (!text) return deptFilteredTree;
    const filterTree = (nodes: any[]): any[] =>
      nodes
        .map((node) => {
          const children = filterTree(node.children || []);
          const displayText = [
            node.code || "",
            node.name || "",
            node.incomeProject || "",
            ...normalizeProjectList(node.associatedIncomeProjects),
          ].join("_").toLowerCase();
          if (displayText.includes(text) || children.length > 0) {
            return { ...node, children };
          }
          return null;
        })
        .filter(Boolean) as any[];
    return filterTree(deptFilteredTree);
  }, [deferredKeyword, deptFilteredTree, open]);

  return (
    <div className="relative">
      <button type="button" disabled={disabled || Boolean(incomeDept && !incomeDept)} onClick={() => setOpen(!open)} className={buttonClass(hasError)}>
        <span className={`min-w-0 truncate ${value ? "text-gray-900" : "text-gray-400"}`} title={displayValue}>
          {displayValue}
        </span>
        <span className="text-gray-400 text-xs shrink-0 ml-2">▼</span>
      </button>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-[280px] overflow-auto">
          <div className="p-2 border-b">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索预算编码、NC项目或渠道"
              className={searchInputClass()}
              autoFocus
            />
          </div>
          <div className="py-1">
            {disabled || tree.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">{disabled ? "加载中..." : "暂无预算编码"}</div>
            ) : incomeDept && deptFilteredTree.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">该部门下暂无预算编码</div>
            ) : filteredTree.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">无匹配预算编码</div>
            ) : (
              renderTree(filteredTree)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 项目树形选择：只选择平台项目名称。
export function ProjectTreeSelect({
  value,
  tree,
  onChange,
  placeholder,
  disabled,
  hasError,
}: {
  value: string;
  tree: any[];
  onChange: (val: string) => void;
  placeholder: string;
  disabled?: boolean;
  hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const displayValue = value || placeholder;

  const renderTree = (nodes: any[], depth = 0) =>
    nodes.map((node) => {
      const isLevel1 = node.level === 1;
      const isSelectable = node.level === 3;
      const indent = depth * 16;
      const displayText = `${node.code}_${node.name}`;

      return (
        <div key={node.id}>
          <div
            className={`flex items-center py-1.5 px-2 text-sm ${
              isSelectable ? "hover:bg-blue-50 cursor-pointer" : "text-gray-400 cursor-default"
            }`}
            style={{ paddingLeft: `${8 + indent}px` }}
            onClick={() => {
              if (isSelectable) {
                onChange(displayText);
                setOpen(false);
                setKeyword("");
              }
            }}
          >
            {node.children && node.children.length > 0 && <span className="text-gray-400 mr-1 text-xs">▼</span>}
            {isLevel1 && <span className="text-gray-400 mr-1 text-xs">├</span>}
            <span className={isLevel1 ? "font-medium text-gray-500" : ""}>{displayText}</span>
            {isLevel1 && <span className="text-xs text-gray-300 ml-1 shrink-0 whitespace-nowrap">(不可选)</span>}
          </div>
          {node.children && node.children.length > 0 && <div>{renderTree(node.children, depth + 1)}</div>}
        </div>
      );
    });

  const filteredTree = useMemo(() => {
    if (!open) return [];
    const text = deferredKeyword.trim().toLowerCase();
    if (!text) return tree;
    const filterTree = (nodes: any[]): any[] =>
      nodes
        .map((node) => {
          const children = filterTree(node.children || []);
          const displayText = `${node.code || ""}_${node.name || ""}`.toLowerCase();
          if (displayText.includes(text) || children.length > 0) {
            return { ...node, children };
          }
          return null;
        })
        .filter(Boolean) as any[];
    return filterTree(tree);
  }, [deferredKeyword, open, tree]);

  return (
    <div className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen(!open)} className={buttonClass(hasError)}>
        <span className={`min-w-0 truncate ${value ? "text-gray-900" : "text-gray-400"}`} title={displayValue}>
          {displayValue}
        </span>
        <span className="text-gray-400 text-xs shrink-0 ml-2">▼</span>
      </button>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-[280px] overflow-auto">
          <div className="p-2 border-b">
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="输入项目关键字搜索" className={searchInputClass()} autoFocus />
          </div>
          <div className="py-1">
            {disabled || tree.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">{disabled ? "加载中..." : "暂无项目数据"}</div>
            ) : filteredTree.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">未找到匹配项目</div>
            ) : (
              renderTree(filteredTree)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// NC项目名称选择：只选择 level=2 且编码以 PM 开头的项目。
export function NCProjectSelect({
  value,
  tree,
  budgetCodeTree,
  budgetCodeValue,
  onChange,
  placeholder,
  disabled,
  hasError,
}: {
  value: string;
  tree: any[];
  budgetCodeTree?: any[];
  budgetCodeValue?: string;
  onChange: (val: string) => void;
  placeholder: string;
  disabled?: boolean;
  hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const displayValue = value || placeholder;
  const { allowedProjectSet, filteredTree, filteredBudgetProjects } = useMemo(() => {
    const empty = {
      allowedProjectSet: new Set<string>(),
      filteredTree: [] as any[],
      filteredBudgetProjects: [] as any[],
    };
    if (!open) return empty;

    const budgetContext = budgetCodeTree && budgetCodeValue ? findBudgetContextByValue(budgetCodeTree, budgetCodeValue) : null;
    const allowedProjectValues = getBudgetContextProjectValues(budgetContext);
    const nextAllowedProjectSet = new Set(allowedProjectValues);
    const text = deferredKeyword.trim().toLowerCase();

    const collectAllowedProjects = (nodes: any[]): any[] =>
      nodes.flatMap((node) => {
        const self = node.level === 2 && /^PM/i.test(node.code || "") && nextAllowedProjectSet.has(projectDisplayValue(node))
          ? [node]
          : [];
        return [...self, ...collectAllowedProjects(node.children || [])];
      });

    const filterTree = (nodes: any[]): any[] =>
      nodes
        .map((node) => {
          const children = filterTree(node.children || []);
          const displayText = projectDisplayValue(node);
          const matchesKeyword = !text || displayText.toLowerCase().includes(text);
          const matchesBudget = nextAllowedProjectSet.size === 0 || node.level !== 2 || nextAllowedProjectSet.has(displayText);
          if ((matchesKeyword && matchesBudget) || children.length > 0) {
            return { ...node, children };
          }
          return null;
        })
        .filter(Boolean) as any[];

    const selectableBudgetProjects = nextAllowedProjectSet.size > 0 ? collectAllowedProjects(tree) : [];
    return {
      allowedProjectSet: nextAllowedProjectSet,
      filteredTree: filterTree(tree),
      filteredBudgetProjects: selectableBudgetProjects.filter((node) =>
        !text || projectDisplayValue(node).toLowerCase().includes(text)
      ),
    };
  }, [budgetCodeTree, budgetCodeValue, deferredKeyword, open, tree]);

  const renderTree = (nodes: any[], depth = 0) =>
    nodes.map((node) => {
      const nodeValue = projectDisplayValue(node);
      const isSelectable = node.level === 2 && /^PM/i.test(node.code || "") && (allowedProjectSet.size === 0 || allowedProjectSet.has(nodeValue));
      const isLevel1 = node.level === 1;
      const indent = depth * 16;
      const displayText = nodeValue;

      return (
        <div key={node.id}>
          <div
            className={`flex items-center py-1.5 px-2 text-sm ${
              isSelectable ? "hover:bg-blue-50 cursor-pointer" : "text-gray-400 cursor-default"
            }`}
            style={{ paddingLeft: `${8 + indent}px` }}
            onClick={() => {
              if (isSelectable) {
                onChange(displayText);
                setOpen(false);
                setKeyword("");
              }
            }}
          >
            {node.children && node.children.length > 0 && <span className="text-gray-400 mr-1 text-xs">▼</span>}
            {isLevel1 && <span className="text-gray-400 mr-1 text-xs">├</span>}
            <span className={isLevel1 ? "font-medium text-gray-500" : ""}>{displayText}</span>
            {isLevel1 && <span className="text-xs text-gray-300 ml-1 shrink-0 whitespace-nowrap">(不可选)</span>}
          </div>
          {node.children && node.children.length > 0 && <div>{renderTree(node.children, depth + 1)}</div>}
        </div>
      );
    });

  return (
    <div className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen(!open)} className={buttonClass(hasError)}>
        <span className={`min-w-0 truncate ${value ? "text-gray-900" : "text-gray-400"}`} title={displayValue}>
          {displayValue}
        </span>
        <span className="text-gray-400 text-xs shrink-0 ml-2">▼</span>
      </button>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-[280px] overflow-auto">
          <div className="p-2 border-b">
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="输入NC项目关键字搜索" className={searchInputClass()} autoFocus />
          </div>
          <div className="py-1">
            {disabled || tree.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">{disabled ? "加载中..." : "暂无项目数据"}</div>
            ) : budgetCodeValue && allowedProjectSet.size === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">该预算编码未关联NC项目</div>
            ) : budgetCodeValue && filteredBudgetProjects.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">未找到匹配NC项目</div>
            ) : !budgetCodeValue && filteredTree.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">未找到匹配NC项目</div>
            ) : budgetCodeValue ? (
              filteredBudgetProjects.map((node) => {
                const displayText = projectDisplayValue(node);
                return (
                  <div
                    key={node.id}
                    className="cursor-pointer px-2 py-1.5 text-sm hover:bg-blue-50"
                    onClick={() => {
                      onChange(displayText);
                      setOpen(false);
                      setKeyword("");
                    }}
                  >
                    {displayText}
                  </div>
                );
              })
            ) : (
              renderTree(filteredTree)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function findProjectNodeByValue(nodes: any[], value: string): any | null {
  const code = value.split("_")[0];
  for (const node of nodes) {
    const displayText = `${node.code}_${node.name}`;
    if (displayText === value || (code && node.code === code)) return node;
    if (node.children?.length) {
      const found = findProjectNodeByValue(node.children, value);
      if (found) return found;
    }
  }
  return null;
}

function findBudgetNodeByValue(nodes: any[], value: string): any | null {
  const code = value.split("-")[0];
  let fallback: any | null = null;
  for (const node of nodes) {
    if (code && node.code === code && node.isLeaf === 1) return node;
    if (code && node.code === code && !fallback) fallback = node;
    if (node.children?.length) {
      const found = findBudgetNodeByValue(node.children, value);
      if (found) return found;
    }
  }
  return fallback;
}

function findPlatformProjectInFundraisingTree(nodes: any[], value: string): any | null {
  const projectPart = value.includes(" / ") ? value.split(" / ").pop() || value : value;
  const code = projectPart.split("_")[0];
  if (!code) return null;
  for (const platform of nodes) {
    const found = (platform.projects || []).find((project: any) => project.code === code);
    if (found) return found;
  }
  return null;
}

// 平台项目名称选择：只选择当前 NC项目名称下的平台项目，可按预算编码对应公益平台进一步过滤。
export function PlatformProjectSelect({
  value,
  tree,
  ncProject,
  ncProjectValue,
  budgetCodeTree,
  budgetCodeValue,
  onChange,
  placeholder,
  disabled,
  hasError,
}: {
  value: string;
  tree: any[];
  ncProject?: string;
  ncProjectValue?: string;
  budgetCodeTree?: any[];
  budgetCodeValue?: string;
  onChange: (val: string) => void;
  placeholder: string;
  disabled?: boolean;
  hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ncProjectKey = ncProjectValue ?? ncProject ?? "";
  const { budgetPlatformId, platformProjects } = useMemo(() => {
    if (!open) return { budgetPlatformId: "", platformProjects: [] as any[] };
    const ncNode = ncProjectKey ? findProjectNodeByValue(tree, ncProjectKey) : null;
    const budgetNode = budgetCodeTree && budgetCodeValue ? findBudgetNodeByValue(budgetCodeTree, budgetCodeValue) : null;
    const nextBudgetPlatformId = budgetNode?.platformId || "";
    const nextPlatformProjects = nextBudgetPlatformId
      ? (ncNode?.children || []).filter((node: any) => node.level === 3 && node.platformId === nextBudgetPlatformId)
      : (ncNode?.children || []).filter((node: any) => node.level === 3);
    return { budgetPlatformId: nextBudgetPlatformId, platformProjects: nextPlatformProjects };
  }, [budgetCodeTree, budgetCodeValue, ncProjectKey, open, tree]);
  const displayValue = value || placeholder;

  return (
    <div className="relative">
      <button type="button" disabled={disabled || !ncProjectKey} onClick={() => setOpen(!open)} className={buttonClass(hasError)}>
        <span className={`min-w-0 truncate ${value ? "text-gray-900" : "text-gray-400"}`} title={displayValue}>
          {displayValue}
        </span>
        <span className="text-gray-400 text-xs shrink-0 ml-2">▼</span>
      </button>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-[240px] overflow-auto">
          <div className="py-1">
            {disabled ? (
              <div className="text-center text-gray-400 py-4 text-sm">加载中...</div>
            ) : !ncProjectKey ? (
              <div className="text-center text-gray-400 py-4 text-sm">请先选择NC项目名称</div>
            ) : platformProjects.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">
                {budgetPlatformId ? "该NC项目下暂无对应公益平台的项目" : "该NC项目下暂无平台项目名称"}
              </div>
            ) : (
              platformProjects.map((node: any) => {
                const projectText = `${node.code}_${node.name}`;
                const displayText = node.platformName ? `${node.platformName} / ${projectText}` : projectText;
                return (
                  <div
                    key={node.id}
                    className="flex items-center py-1.5 px-2 text-sm hover:bg-blue-50 cursor-pointer min-w-0 whitespace-nowrap"
                    onClick={() => {
                      onChange(displayText);
                      setOpen(false);
                    }}
                    title={displayText}
                  >
                    {node.platformName && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 mr-2 shrink-0 max-w-[110px] truncate">
                        {node.platformName}
                      </span>
                    )}
                    <span className="min-w-0 truncate">{projectText}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 平台项目详情选择：根据已选平台项目名称筛选该项目下的详情。
export function PlatformProjectDetailSelect({
  value,
  tree,
  platformProjectValue,
  onChange,
  placeholder,
  disabled,
  hasError,
}: {
  value: string;
  tree: any[];
  platformProjectValue: string;
  onChange: (val: string) => void;
  placeholder: string;
  disabled?: boolean;
  hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const details = useMemo(() => {
    if (!open || !platformProjectValue) return [];
    const project = findPlatformProjectInFundraisingTree(tree, platformProjectValue);
    return project?.details || [];
  }, [open, platformProjectValue, tree]);
  const displayValue = value || placeholder;

  return (
    <div className="relative">
      <button type="button" disabled={disabled || !platformProjectValue} onClick={() => setOpen(!open)} className={buttonClass(hasError)}>
        <span className={`min-w-0 truncate ${value ? "text-gray-900" : "text-gray-400"}`} title={displayValue}>
          {displayValue}
        </span>
        <span className="text-gray-400 text-xs shrink-0 ml-2">▼</span>
      </button>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-[240px] overflow-auto">
          <div className="py-1">
            {disabled ? (
              <div className="text-center text-gray-400 py-4 text-sm">加载中...</div>
            ) : !platformProjectValue ? (
              <div className="text-center text-gray-400 py-4 text-sm">请先选择平台项目名称</div>
            ) : details.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">该平台项目暂无项目详情</div>
            ) : (
              details.map((detail: any) => {
                const displayText = `${detail.code}_${detail.detailInfo}`;
                return (
                  <div
                    key={detail.id}
                    className="flex items-center py-1.5 px-2 text-sm hover:bg-blue-50 cursor-pointer min-w-0 whitespace-nowrap"
                    onClick={() => {
                      onChange(displayText);
                      setOpen(false);
                    }}
                    title={displayText}
                  >
                    <span className="font-mono text-xs text-gray-500 mr-2 shrink-0">{detail.code}</span>
                    <span className="min-w-0 truncate">{detail.detailInfo}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 捐赠活动树形选择：只选活动说明 level=2。
export function DonationActivitySelect({
  value,
  tree,
  onChange,
  placeholder,
  disabled,
  hasError,
}: {
  value: string;
  tree: any[];
  onChange: (val: string) => void;
  placeholder: string;
  disabled?: boolean;
  hasError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword);
  const displayValue = value || placeholder;

  const renderTree = (nodes: any[], depth = 0) =>
    nodes.map((node) => {
      const isCategory = node.level === 1;
      const isLeaf = node.level === 2;
      const indent = depth * 16;

      return (
        <div key={node.id}>
          <div
            className={`flex items-center py-1.5 px-2 text-sm ${
              isLeaf ? "hover:bg-blue-50 cursor-pointer" : "text-gray-400 cursor-default"
            }`}
            style={{ paddingLeft: `${8 + indent}px` }}
            onClick={() => {
              if (isLeaf) {
                onChange(node.name);
                setOpen(false);
                setKeyword("");
              }
            }}
          >
            {node.children && node.children.length > 0 && <span className="text-gray-400 mr-1 text-xs">▼</span>}
            {isCategory && <span className="text-gray-400 mr-1 text-xs">├</span>}
            <span className={isCategory ? "font-medium text-gray-500" : ""}>{node.code}_{node.name}</span>
            {isCategory && <span className="text-xs text-gray-300 ml-1 shrink-0 whitespace-nowrap">(分类)</span>}
          </div>
          {node.children && node.children.length > 0 && <div>{renderTree(node.children, depth + 1)}</div>}
        </div>
      );
    });

  const filteredTree = useMemo(() => {
    if (!open) return [];
    const text = deferredKeyword.trim().toLowerCase();
    if (!text) return tree;
    const filterTree = (nodes: any[]): any[] =>
      nodes
        .map((node) => {
          const children = filterTree(node.children || []);
          const displayText = `${node.code || ""}_${node.name || ""}`.toLowerCase();
          if (displayText.includes(text) || children.length > 0) {
            return { ...node, children };
          }
          return null;
        })
        .filter(Boolean) as any[];
    return filterTree(tree);
  }, [deferredKeyword, open, tree]);

  return (
    <div className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen(!open)} className={buttonClass(hasError)}>
        <span className={`min-w-0 truncate ${value ? "text-gray-900" : "text-gray-400"}`} title={displayValue}>
          {displayValue}
        </span>
        <span className="text-gray-400 text-xs shrink-0 ml-2">▼</span>
      </button>
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-[240px] overflow-auto">
          <div className="p-2 border-b">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索捐赠活动"
              className={searchInputClass()}
              autoFocus
            />
          </div>
          <div className="py-1">
            {disabled || tree.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">{disabled ? "加载中..." : "暂无捐赠活动"}</div>
            ) : filteredTree.length === 0 ? (
              <div className="text-center text-gray-400 py-4 text-sm">无匹配捐赠活动</div>
            ) : (
              renderTree(filteredTree)
            )}
          </div>
        </div>
      )}
    </div>
  );
}
