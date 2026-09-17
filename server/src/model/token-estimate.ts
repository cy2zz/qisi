// token 保守估计。
//
// 规格依据 contracts/README.md §6：「模型不支持精确usage时，用保守输入token估计+
// max_output预留，记录estimated；未知usage不能绕过预算。」
//
// 「保守」= 宁可高估不可低估。低估会让实际消耗越过 runtime.json 的上限而不被察觉；
// 高估最多导致提前停止并返回中性说明——后者可接受且可观测。

// 判据刻意取得粗：凡非 ASCII（码点 > 0x7F）一律按 1 token/字符计。
// 这样中文、假名、全角标点、数学符号（′ ² ∑ 等）都被覆盖，且不需要枚举 Unicode
// 区块。代价是把 é 这类非 ASCII 拉丁字母也高估了一倍——高估是安全方向。
const ASCII_MAX_CODE_POINT = 0x7f;

const NON_ASCII_TOKENS_PER_CHAR = 1;
const ASCII_TOKENS_PER_CHAR = 0.5;

export function estimateTokens(text: string): number {
  let nonAscii = 0;
  let ascii = 0;
  for (const character of text) {
    // 用 codePointAt 而非 charCodeAt：星号面字符按单个字符计，不会因代理对被算两次。
    if ((character.codePointAt(0) ?? 0) > ASCII_MAX_CODE_POINT) nonAscii += 1;
    else ascii += 1;
  }
  return Math.ceil(nonAscii * NON_ASCII_TOKENS_PER_CHAR + ascii * ASCII_TOKENS_PER_CHAR);
}

/**
 * 估计一次请求的输入 token。system 与 input 一并计入；JSON 序列化失败时
 * 退回 String(value) 而非返回 0，避免序列化异常变成预算漏洞。
 */
export function estimateInputTokens(system: string, input: unknown): number {
  let serialised: string;
  try {
    serialised = JSON.stringify(input) ?? String(input);
  } catch {
    serialised = String(input);
  }
  return estimateTokens(system) + estimateTokens(serialised);
}
