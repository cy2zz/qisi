$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
$dir='D:\math\research-evidence'
$items=@{
 'pnas-fulltext'='https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12232635/fullTextXML';
 'mathtutor-readme'='https://raw.githubusercontent.com/eth-lre/mathtutorbench/HEAD/README.md';
 'mathtutor-license'='https://raw.githubusercontent.com/eth-lre/mathtutorbench/HEAD/LICENSE';
 'mathtutor-tree'='https://github.com/eth-lre/mathtutorbench';
 'ranedeer-license'='https://raw.githubusercontent.com/JushBJJ/Mr.-Ranedeer-AI-Tutor/HEAD/LICENSE.md';
 'pix2text-model-card'='https://huggingface.co/breezedeus/pix2text-mfr/raw/main/README.md'
}
foreach($name in $items.Keys){
 try{$r=Invoke-WebRequest -Uri $items[$name] -UseBasicParsing -TimeoutSec 25; [IO.File]::WriteAllText("$dir\$name.txt",$r.Content,[Text.UTF8Encoding]::new()); Write-Output "$name OK $($r.Content.Length)"}catch{Write-Output "$name ERROR $($_.Exception.Message)"}
}
