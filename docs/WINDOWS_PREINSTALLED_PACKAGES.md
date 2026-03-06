# Windows 内置 Python 预装包列表

## 概述

为了提升开箱即用体验，Windows 版本的内置 Python 预装了常用的数据处理和工具包。

## 预装包列表

### 数据处理

| 包名 | 版本 | 用途 | 依赖 |
|------|------|------|------|
| **pandas** | 最新 | 数据分析和处理 | numpy, python-dateutil, tzdata |
| **numpy** | 最新 | 数值计算（pandas 依赖） | - |
| **openpyxl** | 最新 | Excel 文件读写 | et-xmlfile |

### 网络和 API

| 包名 | 版本 | 用途 | 依赖 |
|------|------|------|------|
| **requests** | 最新 | HTTP 请求库 | urllib3, certifi, charset-normalizer, idna |

### 解析和处理

| 包名 | 版本 | 用途 | 依赖 |
|------|------|------|------|
| **beautifulsoup4** | 最新 | HTML/XML 解析 | soupsieve |
| **lxml** | 最新 | 快速 XML/HTML 解析器 | - |
| **pyyaml** | 最新 | YAML 文件解析 | - |
| **jsonschema** | 最新 | JSON 模式验证 | attrs, jsonschema-specifications, referencing, rpds-py |

### 图像处理

| 包名 | 版本 | 用途 | 依赖 |
|------|------|------|------|
| **pillow** | 最新 | 图像处理库 | - |

### 工具

| 包名 | 版本 | 用途 | 依赖 |
|------|------|------|------|
| **python-dotenv** | 最新 | 环境变量管理 | - |

## 使用示例

### Excel 文件处理

```python
import openpyxl

# 读取 Excel
wb = openpyxl.load_workbook('data.xlsx')
ws = wb.active

# 写入数据
ws['A1'] = 'Hello'
wb.save('output.xlsx')
```

### 数据分析

```python
import pandas as pd

# 读取 CSV
df = pd.read_csv('data.csv')

# 数据处理
result = df.groupby('category').sum()

# 导出 Excel
result.to_excel('output.xlsx')
```

### HTTP 请求

```python
import requests

response = requests.get('https://api.github.com')
data = response.json()
print(data)
```

### HTML 解析

```python
from bs4 import BeautifulSoup
import requests

html = requests.get('https://example.com').text
soup = BeautifulSoup(html, 'lxml')
title = soup.find('title').text
```

### 图像处理

```python
from PIL import Image

# 打开图像
img = Image.open('photo.jpg')

# 调整大小
img_resized = img.resize((800, 600))

# 保存
img_resized.save('photo_resized.jpg')
```

## 安装大小

- **基础 Python**: ~50MB
- **pip + 预装包**: ~100MB
- **总计**: ~150MB

## 额外包安装

如果需要其他包，可以使用 pip 安装：

```bash
pip install matplotlib seaborn scikit-learn
```

## 构建流程

预装包在 Windows 构建时自动安装：

1. 下载嵌入式 Python
2. 安装 pip
3. 运行 `preinstall-packages.cjs` 安装预定义包
4. 打包到安装程序

## 手动预装（开发时）

```bash
cd apps/electron
bun run tools:download           # 下载 Python
bun run tools:setup-pip          # 安装 pip
bun run tools:preinstall-packages # 预装包
```

## 包选择原则

预装的包满足以下条件：

1. **常用性**: Agent 场景中经常使用
2. **纯 Python 或有 wheel**: 不需要编译
3. **依赖少**: 避免过多依赖
4. **体积合理**: 单个包不超��� 50MB

## 不预装的包

以下包不预装，但可以通过 pip 安装：

- **matplotlib**: 体积大（~50MB），不是所有场景都需要
- **scikit-learn**: 体积大（~30MB），机器学习专用
- **tensorflow/pytorch**: 体积巨大（>500MB），深度学习专用
- **jupyter**: 交互式环境，Agent 不需要

## 更新预装包列表

修改 `apps/electron/scripts/preinstall-packages.cjs` 中的 `PACKAGES` 数组：

```javascript
const PACKAGES = [
  'openpyxl',
  'pandas',
  'requests',
  // 添加新包...
];
```

然后重新构建 Windows 版本。
