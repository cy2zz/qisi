export const MATH_FORMULA_SHORTCUTS = [
  { label: '分式', name: '插入分式', syntax: '$\\frac{}{}$' },
  { label: '根式', name: '插入根式', syntax: '$\\sqrt{}$' },
  { label: '上标', name: '插入上标', syntax: '$x^{}$' },
  { label: '下标', name: '插入下标', syntax: '$x_{}$' },
  { label: '绝对值', name: '插入绝对值', syntax: '$\\left|{}\\right|$' },
  { label: '括号', name: '插入自适应括号', syntax: '$\\left({}\\right)$' },
  { label: '求和', name: '插入求和', syntax: '$\\sum_{}^{}$' },
  { label: '积分', name: '插入积分', syntax: '$\\int_{}^{}$' },
  { label: '极限', name: '插入极限', syntax: '$\\lim_{x\\to {}}$' },
  { label: '向量', name: '插入向量', syntax: '$\\vec{}$' },
  { label: '联立', name: '插入联立式', syntax: '$\\begin{cases}{}\\\\{}\\end{cases}$' },
] as const;
