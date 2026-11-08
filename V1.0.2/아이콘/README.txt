# MY 일정관리 PWA & 데스크톱 아이콘 종합세트

## 파일 구성 안내
1. **favicon.ico** (16x16, 32x32, 48x48 포함) : PC 브라우저 탭 기본 파비콘
2. **favicon-16x16.png / favicon-32x32.png** : 고해상도 브라우저 파비콘
3. **apple-touch-icon.png** (180x180) : 아이폰/아이패드 홈 화면 바로가기용 (iOS 전용)
4. **icon-maskable-192x192.png / icon-maskable-512x512.png** : 안드로이드 원형/스퀘어클 런처용 (마스크에 잘리지 않도록 안전 여백 적용)
5. **icon-192x192.png / icon-512x512.png** : 일반 PWA 및 스토어 등록용 기본 아이콘
6. **app-icon.ico** (16~256px 멀티 해상도) : C# 윈도우 단독 설치형 프로그램 (.exe) 빌드용 아이콘
7. **manifest.json** : PWA 웹 앱 매니페스트 예시 파일
8. **html-head-tags.html** : index.html의 <head> 태그에 붙여넣을 코드

## 적용 방법
- 기존 "D:\coding\Utility\office\2. MY 일정관리\아이콘" 폴더에 압축을 풀어 넣으시면 됩니다.
- 깃허브 웹 프로젝트의 index.html 상단에 `html-head-tags.html` 내용을 복사해 붙여넣으세요.
- C# 프로젝트 속성(Application Icon)에서는 `app-icon.ico`를 지정하시면 됩니다.
