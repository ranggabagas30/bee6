- Remove "Your demo session has ended." in the Entry Page -> DONE
- The "Preparing your questions" took longer than 4 minutes. Please check if it actually process the data or just a navigation bug (stucked) -> DONE
- The "upload" status should be put on the top of Listening asset animation, because when the draw UI is opened, the upload status is covered and judges may not understand why the stage of scenario does not move to the next -> DONE
- 
 The actual : When click the "Open Supervisor View", then it shows tabs "Staff", "Supervisor", "Owner" -> DONE
 The expected : Remove the tab. Sign in as supervisor directly after clicking the button. Move the credentials hint into drawer UI 
- Got warning message : iframe.js:315 Info: The current domain is not authorized for OAuth operations. This will prevent signInWithPopup, signInWithRedirect, linkWithPopup and linkWithRedirect from working. Add your domain (web-develop-33uzb53tza-et.a.run.app) to the OAuth redirect domains list in the Firebase console -> Authentication -> Settings -> Authorized domains tab. -> DONE
- Got error : "Too many demo sessions from this network today. Try again in about 10 h." when using incognito and just tested once. -> DONE
- I want the draw UI is auto opened when the user start the listening session -> DONE
- The debrief question only mention about the time that need confirmation and do not show the which line or segment that need clarification. It would be so hard to remember and to give confirmation. My recommendation : show the exact line or sentence that being flagged as question, follow the design -> DONE
- In debrief session, there is a button "Check for new questions". I don't know what is used for. If not useful, then remove it. -> DONE
- After sign out from supervisor or owner account, I was redirected to /sign-in and it still shows the tab "Staff", "Supervisor", "Owner". Remove it -> DONE
- After sign out from supervisor or owner account, I was redirected to /sign-in. I want to redirect to entry page instead. 
The continue to try as staff, supervisor, or owner. You mentioned that the session will be restarted after creating a new fresh Incognito window. So my expectation above should not be a problem. -> DONE
- The Sign in form should be centered horizontally -> DONE
- Remove the "Upcoming" of the SOP version. Only use the "Current" mark on the latest version being used to indicate which version is currently applied -> DONE
- Testing on the "web" : 
 - The supervisor need to click the generate proposal button twice to generate two proposals. I want just a click can generate all required proposals. The supervisor can reject or mark it not feasible anyway. -> DONE
 - When the supervisor approve the proposal, there is "Sign in as Owner" button on the bottom of approved proposal. No need that button, because the judge can just sign out and sign in using the existing button and flow -> DONE
 - When sign in as owner and trying to approve both proposals, there is a warning message on second proposal : "Not available: the SOP changed. This proposal was drafted on the old SOP version, so it can only be rejected. A rejection reason becomes a rule Bee6 respects.". The expectation that every proposal can be approved or rejected. So the overall choice will be applied to the new SOP version. -> DONE
 - Got warning : 
  https://web-33uzb53tza-et.a.run.app/_next/static/chunks/1t2d3196r9k-9.css was preloaded using link preload but not used within a few seconds from the window's load event. Please make sure it has an appropriate `as` value and it is preloaded intentionally. -> CANCELLED 
  



- QA 18 Oct: see docs/tasks/QA-feedback2-round3-18oct.md
