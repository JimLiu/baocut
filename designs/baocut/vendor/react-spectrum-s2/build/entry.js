import {Alert, PromptField, PromptFieldValue, PromptTokenField, PromptFieldToolbar, PromptFieldSubmitButton, InsertMenuButton, CommandMenuItem, InsertTokenMenuItem, InsertTextMenuItem, AttachmentList, Attachment, AttachmentPreview, UserMessage, ResponseStatus, ResponseStatusTitle, ResponseStatusPanel, ExecutionTrace, ExecutionTraceItem, MessageSuggestionList, MessageSuggestion} from '@react-spectrum/ai';
// RSP.AI.loader: every PixelLoader shape (Cell[] icons and Cell[][] presets); the prototype picks only the names listed in app/model-agent-loader.js.
import * as loader from '@react-spectrum/ai/loader';
const {PixelLoader, microphone} = loader;
export const AI = {Alert, PixelLoader, microphone, loader, PromptField, PromptFieldValue, PromptTokenField, PromptFieldToolbar, PromptFieldSubmitButton, InsertMenuButton, CommandMenuItem, InsertTokenMenuItem, InsertTextMenuItem, AttachmentList, Attachment, AttachmentPreview, UserMessage, ResponseStatus, ResponseStatusTitle, ResponseStatusPanel, ExecutionTrace, ExecutionTraceItem, MessageSuggestionList, MessageSuggestion};
export {ColorSwatchPicker, ColorSwatch} from '@react-spectrum/s2/ColorSwatchPicker';
export {NumberField} from '@react-spectrum/s2/NumberField';
export {Disclosure, DisclosureTitle, DisclosurePanel, DisclosureHeader} from '@react-spectrum/s2/Disclosure';
export {PickerSection} from '@react-spectrum/s2/Picker';
export {DialogTrigger} from '@react-spectrum/s2/Popover';
export {ColorArea, parseColor} from '@react-spectrum/s2/ColorArea';
export {ColorSlider} from '@react-spectrum/s2/ColorSlider';
export {ColorField} from '@react-spectrum/s2/ColorField';
// Only components used by the prototypes; subpath exports keep unrelated widgets out.
export {createIcon} from '@react-spectrum/s2/Icon';
export {ActionButton} from '@react-spectrum/s2/ActionButton';
export {ActionButtonGroup} from '@react-spectrum/s2/ActionButtonGroup';
export {ActionMenu} from '@react-spectrum/s2/ActionMenu';
export {Badge} from '@react-spectrum/s2/Badge';
export {Button} from '@react-spectrum/s2/Button';
export {ButtonGroup} from '@react-spectrum/s2/ButtonGroup';
export {Card} from '@react-spectrum/s2/Card';
export {CardPreview} from '@react-spectrum/s2/Card';
export {CardView} from '@react-spectrum/s2/CardView';
export {GridList, GridListItem} from 'react-aria-components/GridList';
export {Cell} from '@react-spectrum/s2/TableView';
export {Checkbox} from '@react-spectrum/s2/Checkbox';
export {Column} from '@react-spectrum/s2/TableView';
export {ComboBox} from '@react-spectrum/s2/ComboBox';
export {ComboBoxItem} from '@react-spectrum/s2/ComboBox';
export {Content} from '@react-spectrum/s2/Content';
export {CustomDialog} from '@react-spectrum/s2/CustomDialog';
export {Dialog} from '@react-spectrum/s2/Dialog';
export {DialogContainer} from '@react-spectrum/s2/AlertDialog';
export {Divider} from '@react-spectrum/s2/Divider';
export {FileTrigger} from '@react-spectrum/s2/FileTrigger';
export {Footer} from '@react-spectrum/s2/Footer';
export {Header} from '@react-spectrum/s2/Header';
export {Heading} from '@react-spectrum/s2/Heading';
export {IllustratedMessage} from '@react-spectrum/s2/IllustratedMessage';
export {InlineAlert} from '@react-spectrum/s2/InlineAlert';
export {Keyboard} from '@react-spectrum/s2/Keyboard';
export {Link} from '@react-spectrum/s2/Link';
export {LinkButton} from '@react-spectrum/s2/LinkButton';
export {Menu} from '@react-spectrum/s2/Menu';
export {MenuItem} from '@react-spectrum/s2/ActionMenu';
export {MenuSection} from '@react-spectrum/s2/ActionMenu';
export {MenuTrigger} from '@react-spectrum/s2/ActionMenu';
export {NotificationBadge} from '@react-spectrum/s2/ActionButton';
export {Picker} from '@react-spectrum/s2/Picker';
export {PickerItem} from '@react-spectrum/s2/Picker';
export {Popover} from '@react-spectrum/s2/Popover';
export {ProgressBar} from '@react-spectrum/s2/ProgressBar';
export {ProgressCircle} from '@react-spectrum/s2/ProgressCircle';
export {Provider} from '@react-spectrum/s2/Provider';
export {Radio} from '@react-spectrum/s2/RadioGroup';
export {RadioGroup} from '@react-spectrum/s2/RadioGroup';
export {Row} from '@react-spectrum/s2/TableView';
export {SearchField} from '@react-spectrum/s2/SearchField';
export {SegmentedControl} from '@react-spectrum/s2/SegmentedControl';
export {SegmentedControlItem} from '@react-spectrum/s2/SegmentedControl';
export {SideNav} from '@react-spectrum/s2/SideNav';
export {SideNavHeader} from '@react-spectrum/s2/SideNav';
export {SideNavItem} from '@react-spectrum/s2/SideNav';
export {SideNavItemContent} from '@react-spectrum/s2/SideNav';
export {SideNavItemLink} from '@react-spectrum/s2/SideNav';
export {SideNavSection} from '@react-spectrum/s2/SideNav';
export {Slider} from '@react-spectrum/s2/Slider';
export {UNSAFE_PortalProvider} from 'react-aria/PortalProvider';
export {StatusLight} from '@react-spectrum/s2/StatusLight';
export {SubmenuTrigger} from '@react-spectrum/s2/ActionMenu';
export {Switch} from '@react-spectrum/s2/Switch';
export {Tab} from '@react-spectrum/s2/Tabs';
export {TabList} from '@react-spectrum/s2/Tabs';
export {TabPanel} from '@react-spectrum/s2/Tabs';
export {TableBody} from '@react-spectrum/s2/TableView';
export {TableHeader} from '@react-spectrum/s2/TableView';
export {TableView} from '@react-spectrum/s2/TableView';
export {Tabs} from '@react-spectrum/s2/Tabs';
export {Text} from '@react-spectrum/s2/Text';
export {TextArea} from '@react-spectrum/s2/TextArea';
export {TextField} from '@react-spectrum/s2/TextField';
export {ToastContainer} from '@react-spectrum/s2/Toast';
export {ToastQueue} from '@react-spectrum/s2/Toast';
export {ToggleButton} from '@react-spectrum/s2/ToggleButton';
export {ToggleButtonGroup} from '@react-spectrum/s2/ToggleButtonGroup';
export {Tooltip} from '@react-spectrum/s2/Tooltip';
export {TooltipTrigger} from '@react-spectrum/s2/Tooltip';
import I_Home from '@react-spectrum/s2/icons/Home';
import I_Folder from '@react-spectrum/s2/icons/Folder';
import I_FolderOpen from '@react-spectrum/s2/icons/FolderOpen';
import I_Search from '@react-spectrum/s2/icons/Search';
import I_AddCircle from '@react-spectrum/s2/icons/AddCircle';
import I_Add from '@react-spectrum/s2/icons/Add';
import I_Bell from '@react-spectrum/s2/icons/Bell';
import I_Settings from '@react-spectrum/s2/icons/Settings';
import I_Chat from '@react-spectrum/s2/icons/Chat';
import I_Play from '@react-spectrum/s2/icons/Play';
import I_Pause from '@react-spectrum/s2/icons/Pause';
import I_More from '@react-spectrum/s2/icons/More';
import I_ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import I_ChevronRight from '@react-spectrum/s2/icons/ChevronRight';
import I_ChevronLeft from '@react-spectrum/s2/icons/ChevronLeft';
import I_ChevronUp from '@react-spectrum/s2/icons/ChevronUp';
import I_Close from '@react-spectrum/s2/icons/Close';
import I_Edit from '@react-spectrum/s2/icons/Edit';
import I_Download from '@react-spectrum/s2/icons/Download';
import I_Share from '@react-spectrum/s2/icons/Share';
import I_Star from '@react-spectrum/s2/icons/Star';
import I_StarFilled from '@react-spectrum/s2/icons/StarFilled';
import I_Clock from '@react-spectrum/s2/icons/Clock';
import I_Image from '@react-spectrum/s2/icons/Image';
import I_Images from '@react-spectrum/s2/icons/Images';
import I_Filter from '@react-spectrum/s2/icons/Filter';
import I_Attach from '@react-spectrum/s2/icons/Attach';
import I_Checkmark from '@react-spectrum/s2/icons/Checkmark';
import I_CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import I_CloseCircle from '@react-spectrum/s2/icons/CloseCircle';
import I_AlertTriangle from '@react-spectrum/s2/icons/AlertTriangle';
import I_AlertDiamond from '@react-spectrum/s2/icons/AlertDiamond';
import I_InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import I_Apps from '@react-spectrum/s2/icons/Apps';
import I_Video from '@react-spectrum/s2/icons/Video';
import I_Text from '@react-spectrum/s2/icons/Text';
import I_Translate from '@react-spectrum/s2/icons/Translate';
import I_Cut from '@react-spectrum/s2/icons/Cut';
import I_Undo from '@react-spectrum/s2/icons/Undo';
import I_Redo from '@react-spectrum/s2/icons/Redo';
import I_History from '@react-spectrum/s2/icons/History';
import I_Layers from '@react-spectrum/s2/icons/Layers';
import I_ViewGrid from '@react-spectrum/s2/icons/ViewGrid';
import I_ViewList from '@react-spectrum/s2/icons/ViewList';
import I_Delete from '@react-spectrum/s2/icons/Delete';
import I_Copy from '@react-spectrum/s2/icons/Copy';
import I_Send from '@react-spectrum/s2/icons/Send';
import I_Code from '@react-spectrum/s2/icons/Code';
import I_Export from '@react-spectrum/s2/icons/Export';
import I_Publish from '@react-spectrum/s2/icons/Publish';
import I_Preview from '@react-spectrum/s2/icons/Preview';
import I_Duplicate from '@react-spectrum/s2/icons/Duplicate';
import I_Properties from '@react-spectrum/s2/icons/Properties';
import I_Sort from '@react-spectrum/s2/icons/Sort';
import I_User from '@react-spectrum/s2/icons/User';
import I_Maximize from '@react-spectrum/s2/icons/Maximize';
import I_Minimize from '@react-spectrum/s2/icons/Minimize';
import I_FullScreen from '@react-spectrum/s2/icons/FullScreen';
import I_FullScreenExit from '@react-spectrum/s2/icons/FullScreenExit';
import I_VolumeOff from '@react-spectrum/s2/icons/VolumeOff';
import I_FileText from '@react-spectrum/s2/icons/FileText';
import I_File from '@react-spectrum/s2/icons/File';
import I_Comment from '@react-spectrum/s2/icons/Comment';
import I_Lock from '@react-spectrum/s2/icons/Lock';
import I_LockOpen from '@react-spectrum/s2/icons/LockOpen';
import I_Refresh from '@react-spectrum/s2/icons/Refresh';
import I_Revert from '@react-spectrum/s2/icons/Revert';
import I_Link from '@react-spectrum/s2/icons/Link';
import I_Bookmark from '@react-spectrum/s2/icons/Bookmark';
import I_ZoomIn from '@react-spectrum/s2/icons/ZoomIn';
import I_ZoomOut from '@react-spectrum/s2/icons/ZoomOut';
import I_Select from '@react-spectrum/s2/icons/Select';
import I_Crop from '@react-spectrum/s2/icons/Crop';
import I_Microphone from '@react-spectrum/s2/icons/Microphone';
import I_MagicWand from '@react-spectrum/s2/icons/MagicWand';
import I_VolumeTwo from '@react-spectrum/s2/icons/VolumeTwo';
import I_Archive from '@react-spectrum/s2/icons/Archive';
import I_HelpCircle from '@react-spectrum/s2/icons/HelpCircle';
import I_Collection from '@react-spectrum/s2/icons/Collection';
import I_Asset from '@react-spectrum/s2/icons/Asset';
import I_Compare from '@react-spectrum/s2/icons/Compare';
import I_Project from '@react-spectrum/s2/icons/Project';
import I_ProjectCreate from '@react-spectrum/s2/icons/ProjectCreate';
import I_Tag from '@react-spectrum/s2/icons/Tag';
import I_AspectRatio from '@react-spectrum/s2/icons/AspectRatio';
import I_Visibility from '@react-spectrum/s2/icons/Visibility';
import I_Data from '@react-spectrum/s2/icons/Data';
import I_Target from '@react-spectrum/s2/icons/Target';
import I_UnlinkHoriz from '@react-spectrum/s2/icons/UnlinkHoriz';
import I_Transcript from '@react-spectrum/s2/icons/Transcript';
import I_AudioWave from '@react-spectrum/s2/icons/AudioWave';
import I_CloseCaptions from '@react-spectrum/s2/icons/CloseCaptions';
import I_Filmstrip from '@react-spectrum/s2/icons/Filmstrip';
import I_MovieCamera from '@react-spectrum/s2/icons/MovieCamera';
import I_MusicNote from '@react-spectrum/s2/icons/MusicNote';
import I_ListBulleted from '@react-spectrum/s2/icons/ListBulleted';
import I_ListMultiSelect from '@react-spectrum/s2/icons/ListMultiSelect';
import I_PinOn from '@react-spectrum/s2/icons/PinOn';
import I_StepBackward from '@react-spectrum/s2/icons/StepBackward';
import I_StepForward from '@react-spectrum/s2/icons/StepForward';
import I_Import from '@react-spectrum/s2/icons/Import';
import I_Upload from '@react-spectrum/s2/icons/Upload';
import I_OpenIn from '@react-spectrum/s2/icons/OpenIn';
import I_Template from '@react-spectrum/s2/icons/Template';
import I_Lightbulb from '@react-spectrum/s2/icons/Lightbulb';
import I_AIMark from '@react-spectrum/s2/icons/AIMark';
import I_Layout from '@react-spectrum/s2/icons/Layout';
import I_ClockPending from '@react-spectrum/s2/icons/ClockPending';
import I_Shapes from '@react-spectrum/s2/icons/Shapes';
import I_StopProcessing from '@react-spectrum/s2/icons/StopProcessing';
import I_Keyboard from '@react-spectrum/s2/icons/Keyboard';
import I_New from '@react-spectrum/s2/icons/New';
import I_CursorClick from '@react-spectrum/s2/icons/CursorClick';
import I_Tools from '@react-spectrum/s2/icons/Tools';
import I_DeviceMultiscreen from '@react-spectrum/s2/icons/DeviceMultiscreen';
import I_DeviceLaptop from '@react-spectrum/s2/icons/DeviceLaptop';
import I_Cloud from '@react-spectrum/s2/icons/Cloud';
import I_GlobeGrid from '@react-spectrum/s2/icons/GlobeGrid';
export const Icons = {
  Home: I_Home,
  Folder: I_Folder,
  FolderOpen: I_FolderOpen,
  Search: I_Search,
  Add: I_Add,
  AddCircle: I_AddCircle,
  Bell: I_Bell,
  Settings: I_Settings,
  Chat: I_Chat,
  Play: I_Play,
  Pause: I_Pause,
  More: I_More,
  ChevronDown: I_ChevronDown,
  ChevronRight: I_ChevronRight,
  ChevronLeft: I_ChevronLeft,
  ChevronUp: I_ChevronUp,
  Close: I_Close,
  Edit: I_Edit,
  Download: I_Download,
  Share: I_Share,
  Star: I_Star,
  StarFilled: I_StarFilled,
  Clock: I_Clock,
  Image: I_Image,
  Images: I_Images,
  Filter: I_Filter,
  Attach: I_Attach,
  Checkmark: I_Checkmark,
  CheckmarkCircle: I_CheckmarkCircle,
  CloseCircle: I_CloseCircle,
  AlertTriangle: I_AlertTriangle,
  AlertDiamond: I_AlertDiamond,
  InfoCircle: I_InfoCircle,
  Apps: I_Apps,
  Video: I_Video,
  Text: I_Text,
  Translate: I_Translate,
  Cut: I_Cut,
  Undo: I_Undo,
  Redo: I_Redo,
  History: I_History,
  Layers: I_Layers,
  ViewGrid: I_ViewGrid,
  ViewList: I_ViewList,
  Delete: I_Delete,
  Copy: I_Copy,
  Send: I_Send,
  Code: I_Code,
  Export: I_Export,
  Publish: I_Publish,
  Preview: I_Preview,
  Duplicate: I_Duplicate,
  Properties: I_Properties,
  Sort: I_Sort,
  User: I_User,
  Maximize: I_Maximize,
  Minimize: I_Minimize,
  FullScreen: I_FullScreen,
  FullScreenExit: I_FullScreenExit,
  VolumeOff: I_VolumeOff,
  FileText: I_FileText,
  File: I_File,
  Comment: I_Comment,
  Lock: I_Lock,
  LockOpen: I_LockOpen,
  Refresh: I_Refresh,
  Revert: I_Revert,
  Link: I_Link,
  Bookmark: I_Bookmark,
  ZoomIn: I_ZoomIn,
  ZoomOut: I_ZoomOut,
  Select: I_Select,
  Crop: I_Crop,
  Microphone: I_Microphone,
  MagicWand: I_MagicWand,
  VolumeTwo: I_VolumeTwo,
  Archive: I_Archive,
  HelpCircle: I_HelpCircle,
  Collection: I_Collection,
  Asset: I_Asset,
  Compare: I_Compare,
  Project: I_Project,
  ProjectCreate: I_ProjectCreate,
  Tag: I_Tag,
  AspectRatio: I_AspectRatio,
  Visibility: I_Visibility,
  Data: I_Data,
  Target: I_Target,
  AudioWave: I_AudioWave,
  Transcript: I_Transcript,
  UnlinkHoriz: I_UnlinkHoriz,
  CloseCaptions: I_CloseCaptions,
  Filmstrip: I_Filmstrip,
  MovieCamera: I_MovieCamera,
  MusicNote: I_MusicNote,
  ListBulleted: I_ListBulleted,
  ListMultiSelect: I_ListMultiSelect,
  PinOn: I_PinOn,
  StepBackward: I_StepBackward,
  StepForward: I_StepForward,
  Import: I_Import,
  Upload: I_Upload,
  OpenIn: I_OpenIn,
  Template: I_Template,
  Lightbulb: I_Lightbulb,
  AIMark: I_AIMark,
  Layout: I_Layout,
  ClockPending: I_ClockPending,
  Shapes: I_Shapes,
  StopProcessing: I_StopProcessing,
  Keyboard: I_Keyboard,
  New: I_New,
  CursorClick: I_CursorClick,
  Tools: I_Tools,
  DeviceMultiscreen: I_DeviceMultiscreen,
  DeviceLaptop: I_DeviceLaptop,
  Cloud: I_Cloud,
  GlobeGrid: I_GlobeGrid,
};
