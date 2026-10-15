// 온라인 길드용 Firebase 설정
// Firebase 콘솔(https://console.firebase.google.com)에서 프로젝트를 만들고
//   1) 빌드 → Authentication → 로그인 방법 → '익명' 사용 설정
//   2) 빌드 → Realtime Database → 데이터베이스 만들기 → 규칙(README의 '길드 서버 규칙')을 붙여 넣기
//   3) 프로젝트 설정 → 일반 → 웹 앱 추가 → apiKey, databaseURL 복사
// 를 마친 뒤 아래 두 칸을 채우세요. (게임 안 길드 회관의 '서버 설정'에 붙여 넣어도 됩니다)
// apiKey는 공개돼도 괜찮은 값이에요. 안전은 데이터베이스 규칙이 지켜 줍니다.
export const FIREBASE = {
  apiKey: 'AIzaSyD_bGIXNy_n0QEhYqaTUS6y97CPBc5tbdQ',
  databaseURL: 'https://dongeon-shooter-default-rtdb.firebaseio.com',
};
