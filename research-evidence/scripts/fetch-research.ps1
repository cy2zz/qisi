$ErrorActionPreference='Stop'
$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
$dir='D:\math\research-evidence'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$repos=@('alephpi/Texo','alephpi/Texo-web','breezedeus/Pix2Text','LinXueyuanStdio/LaTeX_OCR_PRO','VikParuchuri/texify','JushBJJ/Mr.-Ranedeer-AI-Tutor','RunzheYang/SocraticAI','Ljyustc/SocraticLM','SenmuuuuW/universal-diagnostic-tutor-skill','JudgePeach/math-question-bank','AI-MO/NuminaMath','KaTeX/KaTeX','sympy/sympy','remarkjs/react-markdown')
$log=@()
foreach($repo in $repos){
 $name=$repo.Replace('/','__')
 foreach($f in @('README.md','LICENSE')){
  $url="https://raw.githubusercontent.com/$repo/HEAD/$f"
  try{$r=Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20; [IO.File]::WriteAllText("$dir\$name.$f",$r.Content,[Text.UTF8Encoding]::new()); $log+="$url OK"}catch{$log+="$url ERROR $($_.Exception.Message)"}
 }
 $url="https://github.com/$repo"
 try{$r=Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20; [IO.File]::WriteAllText("$dir\$name.page.html",$r.Content,[Text.UTF8Encoding]::new()); $log+="$url OK"}catch{$log+="$url ERROR $($_.Exception.Message)"}
}
foreach($id in @('2504.08649','2602.17189')){
 $url="https://arxiv.org/abs/$id"
 try{$r=Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20; [IO.File]::WriteAllText("$dir\arxiv-$id.html",$r.Content,[Text.UTF8Encoding]::new()); $log+="$url OK"}catch{$log+="$url ERROR $($_.Exception.Message)"}
}
$log | Set-Content -LiteralPath "$dir\fetch-log.txt" -Encoding UTF8
$log
